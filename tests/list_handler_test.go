package tests

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sylly-mika/bugkit"
)

// fakeLister records the pages it is asked for and answers with page and err.
type fakeLister struct {
	pages []int
	page  bugkit.ReportPage
	err   error
}

func (l *fakeLister) List(_ context.Context, page int) (bugkit.ReportPage, error) {
	l.pages = append(l.pages, page)
	return l.page, l.err
}

func TestListHandlerForwardsThePage(t *testing.T) {
	cases := []struct {
		name, target string
		want         int
	}{
		{"page 3", "/?page=3", 3},
		{"page 0", "/?page=0", 1},
		{"page x", "/?page=x", 1},
		{"page -2", "/?page=-2", 1},
		{"no page", "/", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lister := &fakeLister{page: bugkit.ReportPage{Meta: bugkit.PageMeta{Page: 1, PerPage: 20}}}
			rec := httptest.NewRecorder()
			bugkit.ListHandler(bugkit.ListConfig{Lister: lister, Who: whoMiky}).
				ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.target, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=UTF-8" {
				t.Errorf("Content-Type = %q", ct)
			}
			if !strings.Contains(rec.Body.String(), `"data":[]`) {
				t.Errorf("body lacks an empty data array: %s", rec.Body.String())
			}
			if len(lister.pages) != 1 || lister.pages[0] != tc.want {
				t.Errorf("Lister asked for %v, want [%d]", lister.pages, tc.want)
			}
		})
	}
}

func TestListHandlerRefuses(t *testing.T) {
	noWho := func(*http.Request) (bugkit.Reporter, bool) { return bugkit.Reporter{}, false }
	cases := []struct {
		name    string
		who     func(*http.Request) (bugkit.Reporter, bool)
		fake    *fakeLister
		status  int
		detail  string
		wantLog []string
	}{
		{"no Who", nil, &fakeLister{}, 401, "Not authenticated.", nil},
		{"Who refuses", noWho, &fakeLister{}, 401, "Not authenticated.", nil},
		{"no Lister", whoMiky, nil, 503, "Bug reporting is not configured on this server.", nil},
		{"intake refuses the key", whoMiky, &fakeLister{err: &bugkit.SinkError{Status: 401}}, 503,
			"Bug reporting is not configured on this server.", nil},
		{"intake forbids the key", whoMiky, &fakeLister{err: &bugkit.SinkError{Status: 403}}, 503,
			"Bug reporting is not configured on this server.", nil},
		{"intake answers a conflict", whoMiky, &fakeLister{err: &bugkit.SinkError{Status: 409}}, 502,
			"The reports could not be loaded.", []string{"bugkit: listing failed", "status=409"}},
		{"intake fails", whoMiky, &fakeLister{err: &bugkit.SinkError{Status: 500}}, 502,
			"The reports could not be loaded.", []string{"bugkit: listing failed", "status=500"}},
		{"transport failure", whoMiky, &fakeLister{err: errors.New("dial")}, 502,
			"The reports could not be loaded.", []string{"bugkit: listing failed"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			cfg := bugkit.ListConfig{Who: tc.who, Logger: slog.New(slog.NewTextHandler(&buf, nil))}
			if tc.fake != nil {
				cfg.Lister = tc.fake
			}
			rec := httptest.NewRecorder()
			bugkit.ListHandler(cfg).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/?page=1", nil))
			assertProblem(t, rec, tc.status, tc.detail)
			if tc.fake != nil && tc.status == 401 && len(tc.fake.pages) != 0 {
				t.Errorf("Lister was called %d times, want 0", len(tc.fake.pages))
			}
			for _, want := range tc.wantLog {
				if !strings.Contains(buf.String(), want) {
					t.Errorf("log lacks %q:\n%s", want, buf.String())
				}
			}
		})
	}
}

// deadlineLister records whether the context it is given has a deadline and how far away it is.
type deadlineLister struct {
	bounded bool
	left    time.Duration
}

func (l *deadlineLister) List(ctx context.Context, _ int) (bugkit.ReportPage, error) {
	deadline, ok := ctx.Deadline()
	l.bounded, l.left = ok, time.Until(deadline)
	return bugkit.ReportPage{}, nil
}

func TestListHandlerBoundsTheListing(t *testing.T) {
	lister := &deadlineLister{}
	cfg := bugkit.ListConfig{Who: whoMiky, Lister: lister, Logger: slog.New(slog.NewTextHandler(new(bytes.Buffer), nil))}
	rec := httptest.NewRecorder()
	bugkit.ListHandler(cfg).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/?page=1", nil))
	if !lister.bounded {
		t.Fatal("the Lister's context has no deadline")
	}
	if lister.left <= 25*time.Second || lister.left > 30*time.Second {
		t.Errorf("the Lister's deadline is %v away, want about 30s", lister.left)
	}
}

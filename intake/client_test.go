package intake_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sylly-mika/bugkit"
	"github.com/sylly-mika/bugkit/intake"
)

const intakePath = "/api/intake/v1/bug-reports"

// testKey is a fixture in the shape of the app's intake keys. No test prints
// it: a failure message says <redacted> in its place.
func testKey() string { return "itk_" + strings.Repeat("k", 43) }

const defaultBody = `{"id":"0192f0c4-0000-7000-8000-000000000001","number":7}`

type gotPart struct {
	Name, FileName, ContentType string
	Value                       []byte
}

type gotRequest struct {
	Method, Path, Auth, Accept, ContentType string
	Parts                                   []gotPart
	Raw                                     []byte
}

// fakeIntake is an httptest intake. It records every request it gets and
// answers with respond, which defaults to 201 with defaultBody.
type fakeIntake struct {
	mu      sync.Mutex
	got     []gotRequest
	respond func(w http.ResponseWriter, r *http.Request, g gotRequest)
}

func (f *fakeIntake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	g := gotRequest{
		Method:      r.Method,
		Path:        r.URL.Path,
		Auth:        r.Header.Get("Authorization"),
		Accept:      r.Header.Get("Accept"),
		ContentType: r.Header.Get("Content-Type"),
		Raw:         raw,
	}
	if _, params, err := mime.ParseMediaType(g.ContentType); err == nil {
		mr := multipart.NewReader(bytes.NewReader(raw), params["boundary"])
		for {
			p, err := mr.NextPart()
			if err != nil {
				break
			}
			v, _ := io.ReadAll(p)
			g.Parts = append(g.Parts, gotPart{
				Name:        p.FormName(),
				FileName:    p.FileName(),
				ContentType: p.Header.Get("Content-Type"),
				Value:       v,
			})
		}
	}
	f.mu.Lock()
	f.got = append(f.got, g)
	f.mu.Unlock()
	f.respond(w, r, g)
}

// requests returns a copy of what the fake has recorded.
func (f *fakeIntake) requests() []gotRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]gotRequest(nil), f.got...)
}

// newFakeIntake starts the fake and returns it with the intake route's URL.
func newFakeIntake(t *testing.T) (*fakeIntake, string) {
	t.Helper()
	f := &fakeIntake{respond: func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, defaultBody)
	}}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, srv.URL + intakePath
}

// onlyRequest returns the single request the fake recorded.
func onlyRequest(t *testing.T, f *fakeIntake) gotRequest {
	t.Helper()
	reqs := f.requests()
	if len(reqs) != 1 {
		t.Fatalf("the fake saw %d requests, want 1", len(reqs))
	}
	return reqs[0]
}

func partNames(parts []gotPart) []string {
	names := make([]string, 0, len(parts))
	for _, p := range parts {
		names = append(names, p.Name)
	}
	return names
}

func findPart(parts []gotPart, name string) (gotPart, bool) {
	for _, p := range parts {
		if p.Name == name {
			return p, true
		}
	}
	return gotPart{}, false
}

func fullReport() bugkit.Report {
	return bugkit.Report{
		Kind:        "feature",
		Summary:     "Export the plan list",
		Description: "Save fails",
		Impact:      "blocks",
		Area:        "/tasks/1",
		Diagnostics: []byte(`{"a":1}`),
		Version:     "v1.2.3",
		Viewport:    "1280x800",
		UserAgent:   "TestBrowser/1.0",
		RequestID:   "req-9",
		Screenshot:  []byte("\x89PNG\r\n\x1a\npixels"),
	}
}

func TestSubmitSendsTheIntakeForm(t *testing.T) {
	f, url := newFakeIntake(t)
	c := intake.New(url, testKey())
	who := bugkit.Reporter{ID: "u-secret-id", Name: "Ann Lee", Email: "ann@example.test"}

	res, err := c.Submit(context.Background(), who, fullReport())
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if res != (bugkit.Result{ID: "0192f0c4-0000-7000-8000-000000000001", Number: 7}) {
		t.Fatalf("Submit result = %+v", res)
	}

	g := onlyRequest(t, f)
	if g.Method != "POST" || g.Path != intakePath {
		t.Fatalf("request = %s %s, want POST %s", g.Method, g.Path, intakePath)
	}
	if g.Auth != "Bearer "+testKey() {
		t.Fatalf("Authorization header is wrong: <redacted>")
	}
	if g.Accept != "application/json" {
		t.Fatalf("Accept = %q", g.Accept)
	}
	if !strings.HasPrefix(g.ContentType, "multipart/form-data; boundary=") {
		t.Fatalf("Content-Type = %q", g.ContentType)
	}

	want := []string{"kind", "summary", "description", "impact", "area", "diagnostics", "version", "viewport",
		"user_agent", "request_id", "reporter_name", "reporter_email", "screenshot"}
	if got := partNames(g.Parts); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("parts = %v, want %v", got, want)
	}
	values := map[string]string{
		"kind":           "feature",
		"summary":        "Export the plan list",
		"description":    "Save fails",
		"impact":         "blocks",
		"area":           "/tasks/1",
		"diagnostics":    `{"a":1}`,
		"version":        "v1.2.3",
		"viewport":       "1280x800",
		"user_agent":     "TestBrowser/1.0",
		"request_id":     "req-9",
		"reporter_name":  "Ann Lee",
		"reporter_email": "ann@example.test",
	}
	for _, p := range g.Parts {
		if p.Name == "screenshot" {
			continue
		}
		if string(p.Value) != values[p.Name] {
			t.Fatalf("part %s = %q, want %q", p.Name, p.Value, values[p.Name])
		}
	}
	shot, _ := findPart(g.Parts, "screenshot")
	if shot.FileName != "screenshot.png" || shot.ContentType != "image/png" {
		t.Fatalf("screenshot part: file %q, type %q", shot.FileName, shot.ContentType)
	}
	if string(shot.Value) != "\x89PNG\r\n\x1a\npixels" {
		t.Fatalf("screenshot bytes differ from the report's")
	}
	if bytes.Contains(g.Raw, []byte("u-secret-id")) {
		t.Fatalf("the reporter's ID was sent to the intake")
	}
}

func TestSubmitLeavesEmptyOptionalPartsOut(t *testing.T) {
	f, url := newFakeIntake(t)
	c := intake.New(url, testKey())
	const diag = "{ \"a\" : [1, 2] }\n"
	r := bugkit.Report{
		Kind:        "bug",
		Description: "  two spaces",
		Impact:      "cosmetic",
		Area:        "/",
		Diagnostics: []byte(diag),
	}

	if _, err := c.Submit(context.Background(), bugkit.Reporter{}, r); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	g := onlyRequest(t, f)
	if got := partNames(g.Parts); strings.Join(got, ",") != "kind,description,impact,area,diagnostics" {
		t.Fatalf("parts = %v, want kind,description,impact,area,diagnostics", got)
	}
	if p, _ := findPart(g.Parts, "kind"); string(p.Value) != "bug" {
		t.Fatalf("kind = %q, want bug", p.Value)
	}
	if p, _ := findPart(g.Parts, "description"); string(p.Value) != "  two spaces" {
		t.Fatalf("description = %q, want it untrimmed", p.Value)
	}
	if p, _ := findPart(g.Parts, "diagnostics"); string(p.Value) != diag {
		t.Fatalf("diagnostics = %q, want %q", p.Value, diag)
	}
}

func TestSubmitRefusesAnUnreadable201(t *testing.T) {
	cases := []struct{ name, body string }{
		{"not json", "not json"},
		{"empty id", "{}"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, url := newFakeIntake(t)
			f.respond = func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				_, _ = io.WriteString(w, tc.body)
			}
			res, err := intake.New(url, testKey()).Submit(context.Background(), bugkit.Reporter{}, fullReport())
			if res != (bugkit.Result{}) {
				t.Fatalf("result = %+v, want zero", res)
			}
			if err == nil || err.Error() != "bugkit: intake answered 201 with an unreadable body" {
				t.Fatalf("error = %v", err)
			}
			if errors.As(err, new(*bugkit.SinkError)) {
				t.Fatalf("an unreadable 201 must not be a *bugkit.SinkError")
			}
		})
	}
}

func TestSubmitAnswersOtherStatusesAsSinkError(t *testing.T) {
	for _, status := range []int{200, 400, 401, 403, 409, 413, 422, 500, 503} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			f, url := newFakeIntake(t)
			f.respond = func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				_, _ = io.WriteString(w, `{"id":"x","number":1,"detail":"BODY-MARKER"}`)
			}
			_, err := intake.New(url, testKey()).Submit(context.Background(), bugkit.Reporter{}, fullReport())
			var se *bugkit.SinkError
			if !errors.As(err, &se) {
				t.Fatalf("error = %v, want a *bugkit.SinkError", err)
			}
			if se.Status != status || se.RetryAfter != 0 {
				t.Fatalf("SinkError = %+v, want status %d and no wait", se, status)
			}
			if want := fmt.Sprintf("bugkit: intake answered %d", status); err.Error() != want {
				t.Fatalf("error text = %q, want %q", err.Error(), want)
			}
		})
	}
}

func TestSubmitDoesNotFollowARedirect(t *testing.T) {
	var elsewhere atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc(intakePath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		w.Header().Set("Location", "/elsewhere")
		w.WriteHeader(http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/elsewhere", func(w http.ResponseWriter, r *http.Request) {
		elsewhere.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, defaultBody)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	_, err := intake.New(srv.URL+intakePath, testKey()).Submit(context.Background(), bugkit.Reporter{}, fullReport())
	var se *bugkit.SinkError
	if !errors.As(err, &se) || se.Status != http.StatusTemporaryRedirect {
		t.Fatalf("error = %v, want a SinkError with status 307", err)
	}
	if n := elsewhere.Load(); n != 0 {
		t.Fatalf("the client followed the redirect %d time(s)", n)
	}
}

// A Client built as a literal, with no HTTP client, must not follow a redirect
// either: the key would go to the second URL.
func TestLiteralClientDoesNotFollowARedirect(t *testing.T) {
	var elsewhere atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		w.Header().Set("Location", "/elsewhere")
		w.WriteHeader(http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/elsewhere", func(w http.ResponseWriter, r *http.Request) {
		elsewhere.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, defaultBody)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	c := &intake.Client{URL: srv.URL + "/", Key: testKey()}
	_, err := c.Submit(context.Background(), bugkit.Reporter{}, fullReport())
	var se *bugkit.SinkError
	if !errors.As(err, &se) || se.Status != http.StatusTemporaryRedirect {
		t.Fatalf("error = %v, want a SinkError with status 307", err)
	}
	if n := elsewhere.Load(); n != 0 {
		t.Fatalf("the client followed the redirect %d time(s)", n)
	}
}

func TestSubmit429CarriesRetryAfter(t *testing.T) {
	cases := []struct {
		name   string
		header string
		set    bool
		want   time.Duration
	}{
		{"seconds", "120", true, 120 * time.Second},
		{"absent", "", false, 0},
		{"not a number", "soon", true, 0},
		{"zero", "0", true, 0},
		{"negative", "-5", true, 0},
		{"fraction", "1.5", true, 0},
		{"http date", "Wed, 21 Oct 2026 07:28:00 GMT", true, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, url := newFakeIntake(t)
			f.respond = func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
				if tc.set {
					w.Header().Set("Retry-After", tc.header)
				}
				w.WriteHeader(http.StatusTooManyRequests)
			}
			_, err := intake.New(url, testKey()).Submit(context.Background(), bugkit.Reporter{}, fullReport())
			var se *bugkit.SinkError
			if !errors.As(err, &se) {
				t.Fatalf("error = %v, want a *bugkit.SinkError", err)
			}
			if se.Status != http.StatusTooManyRequests || se.RetryAfter != tc.want {
				t.Fatalf("SinkError = %+v, want status 429 and wait %v", se, tc.want)
			}
		})
	}
}

func TestClientNeverPrintsTheKey(t *testing.T) {
	f, url := newFakeIntake(t)
	c := intake.New(url, testKey())

	shown := fmt.Sprintf("%v|%+v|%s|%#v|%v|%#v", c, c, c, c, *c, *c)
	if strings.Contains(shown, testKey()) {
		t.Fatalf("a printed Client holds the key: <redacted>")
	}
	if !strings.Contains(shown, "<redacted>") || !strings.Contains(shown, url) {
		t.Fatalf("a printed Client lacks <redacted> or the URL: %s", shown)
	}

	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, nil)).Info("x", "client", c)
	if strings.Contains(buf.String(), testKey()) {
		t.Fatalf("the log line holds the key: <redacted>")
	}
	if !strings.Contains(buf.String(), "<redacted>") {
		t.Fatalf("the log line lacks <redacted>")
	}

	f.respond = func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
		w.WriteHeader(http.StatusUnauthorized)
	}
	_, err := c.Submit(context.Background(), bugkit.Reporter{}, fullReport())
	if err != nil && strings.Contains(err.Error(), testKey()) {
		t.Fatalf("the 401 error holds the key: <redacted>")
	}

	srv := httptest.NewServer(http.NotFoundHandler())
	closed := srv.URL + intakePath
	srv.Close()
	_, err = intake.New(closed, testKey()).Submit(context.Background(), bugkit.Reporter{}, fullReport())
	if err == nil {
		t.Fatalf("Submit to a closed server returned no error")
	}
	if strings.Contains(err.Error(), testKey()) {
		t.Fatalf("the transport error holds the key: <redacted>")
	}
}

func TestSubmitStopsAtTheContextDeadline(t *testing.T) {
	release := make(chan struct{})
	f, url := newFakeIntake(t)
	t.Cleanup(func() { close(release) })
	f.respond = func(w http.ResponseWriter, r *http.Request, _ gotRequest) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := intake.New(url, testKey()).Submit(ctx, bugkit.Reporter{}, fullReport())
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("Submit took %v, want it to stop at the context deadline", elapsed)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want context.DeadlineExceeded", err)
	}
	if errors.As(err, new(*bugkit.SinkError)) {
		t.Fatalf("a deadline must not be a *bugkit.SinkError")
	}
}

func TestSubmitIsSafeForConcurrentUse(t *testing.T) {
	f, url := newFakeIntake(t)
	f.respond = func(w http.ResponseWriter, _ *http.Request, g gotRequest) {
		desc, _ := findPart(g.Parts, "description")
		n, _ := strconv.Atoi(strings.TrimPrefix(string(desc.Value), "report "))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = fmt.Fprintf(w, `{"id":"0192f0c4-0000-7000-8000-000000000001","number":%d}`, n)
	}
	c := intake.New(url, testKey())

	const n = 20
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := bugkit.Report{Description: fmt.Sprintf("report %d", i), Impact: "blocks", Area: "/", Diagnostics: []byte("{}")}
			res, err := c.Submit(context.Background(), bugkit.Reporter{}, r)
			if err != nil {
				errs <- fmt.Errorf("goroutine %d: %v", i, err)
				return
			}
			if res.Number != i {
				errs <- fmt.Errorf("goroutine %d got number %d", i, res.Number)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}

	reqs := f.requests()
	if len(reqs) != n {
		t.Fatalf("the fake saw %d requests, want %d", len(reqs), n)
	}
	for _, g := range reqs {
		count := 0
		for _, p := range g.Parts {
			if p.Name == "description" {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("a request has %d description parts, want 1", count)
		}
	}
}

func TestListSendsTheIntakeRequest(t *testing.T) {
	var mu sync.Mutex
	var method, path, query, auth, accept string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		method, path, query, auth = r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Get("Authorization")
		accept = r.Header.Get("Accept")
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"number":12,"title":"Login fails","status":"Done","status_category":"done","reporter_name":null,"reported_at":"2026-10-20T10:00:00Z","updated_at":"2026-10-21T10:00:00Z"}],"meta":{"page":2,"per_page":20,"total":21,"total_pages":2}}`)
	}))
	defer srv.Close()

	key := testKey()
	page, err := intake.New(srv.URL+intakePath, key).List(context.Background(), 2)
	if err != nil {
		t.Fatalf("List: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if method != http.MethodGet {
		t.Errorf("method = %s, want GET", method)
	}
	if path != intakePath {
		t.Errorf("path = %s, want %s", path, intakePath)
	}
	if query != "page=2&per_page=20" {
		t.Errorf("query = %q, want page=2&per_page=20", query)
	}
	if auth != "Bearer "+key {
		t.Errorf("Authorization is not the intake key (<redacted>)")
	}
	if accept != "application/json" {
		t.Errorf("Accept = %q, want application/json", accept)
	}

	if len(page.Data) != 1 {
		t.Fatalf("got %d items, want 1", len(page.Data))
	}
	item := page.Data[0]
	if item.Number != 12 || item.Title != "Login fails" || item.Status != "Done" || item.StatusCategory != "done" {
		t.Errorf("item = %+v", item)
	}
	if item.ReporterName != nil {
		t.Errorf("ReporterName = %q, want nil", *item.ReporterName)
	}
	if !item.ReportedAt.Equal(time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("ReportedAt = %v", item.ReportedAt)
	}
	if !item.UpdatedAt.Equal(time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("UpdatedAt = %v", item.UpdatedAt)
	}
	if want := (bugkit.PageMeta{Page: 2, PerPage: 20, Total: 21, TotalPages: 2}); page.Meta != want {
		t.Errorf("meta = %+v, want %+v", page.Meta, want)
	}
}

func TestListRefusesAnOversizedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[],"meta":{"page":1,"per_page":20,"total":0,"total_pages":0},"pad":"`+strings.Repeat("x", 1<<20)+`"}`)
	}))
	defer srv.Close()

	_, err := intake.New(srv.URL+intakePath, testKey()).List(context.Background(), 1)
	if err == nil || err.Error() != "bugkit: intake answered 200 with an unreadable body" {
		t.Fatalf("error = %v, want the unreadable-body error", err)
	}
}

func TestListAnswersErrors(t *testing.T) {
	var elsewhere atomic.Int32
	cases := []struct {
		name       string
		respond    func(w http.ResponseWriter, r *http.Request)
		sinkStatus int
		text       string
	}{
		{"a refused key", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }, 401, ""},
		{"an intake failure", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }, 500, ""},
		{"a redirect", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != intakePath {
				elsewhere.Add(1)
				w.WriteHeader(http.StatusOK)
				return
			}
			http.Redirect(w, r, "/elsewhere", http.StatusFound)
		}, 302, ""},
		{"an unreadable 200", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "{") }, 0,
			"bugkit: intake answered 200 with an unreadable body"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(tc.respond))
			defer srv.Close()
			key := testKey()

			_, err := intake.New(srv.URL+intakePath, key).List(context.Background(), 1)
			if err == nil {
				t.Fatal("List returned no error")
			}
			if strings.Contains(err.Error(), key) {
				t.Error("the error holds the intake key")
			}
			if n := elsewhere.Load(); n != 0 {
				t.Fatalf("the redirect target was hit %d times", n)
			}
			if tc.text != "" {
				if err.Error() != tc.text {
					t.Fatalf("error = %q, want %q", err.Error(), tc.text)
				}
				return
			}
			var se *bugkit.SinkError
			if !errors.As(err, &se) || se.Status != tc.sinkStatus {
				t.Fatalf("error = %v, want a *SinkError with status %d", err, tc.sinkStatus)
			}
		})
	}
}

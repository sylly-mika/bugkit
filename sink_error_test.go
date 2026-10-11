package bugkit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// failingSink is a Sink whose Submit always returns the given error.
type failingSink struct{ err error }

func (s failingSink) Submit(ctx context.Context, who Reporter, r Report) (Result, error) {
	return Result{}, s.err
}

// serveSinkFailure posts a valid browser form to a handler whose sink returns
// err, and returns the response and the log text.
func serveSinkFailure(t *testing.T, err error) (*httptest.ResponseRecorder, string) {
	t.Helper()
	var buf bytes.Buffer
	cfg := Config{
		Sink: failingSink{err},
		Who: func(*http.Request) (Reporter, bool) {
			return Reporter{ID: "u-1", Name: "Ann Lee", Email: "reporter@example.test"}, true
		},
		Limiter: NewRateLimiter(100, time.Hour),
		Limits:  DefaultLimits(),
		Logger:  slog.New(slog.NewTextHandler(&buf, nil)),
	}
	fields := map[string]string{
		"description": "Broken save",
		"impact":      "blocks",
		"area":        "/tasks",
		"diagnostics": "{}",
	}
	body, contentType := multipartBody(t, fields, nil)
	req := httptest.NewRequest("POST", "/bug-reports", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	Handler(cfg).ServeHTTP(rec, req)
	return rec, buf.String()
}

func problemDetailOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("response body is not a problem: %v", err)
	}
	return p.Detail
}

func TestSinkError429RelaysTheWait(t *testing.T) {
	err := fmt.Errorf("relay: %w", &SinkError{Status: 429, RetryAfter: 120 * time.Second})
	rec, _ := serveSinkFailure(t, err)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "120" {
		t.Fatalf("Retry-After = %q, want 120", got)
	}
	want := "Too many bug reports. Try again in 120 seconds."
	if got := problemDetailOf(t, rec); got != want {
		t.Fatalf("detail = %q, want %q", got, want)
	}
}

func TestSinkError429RoundsTheWaitUp(t *testing.T) {
	cases := []struct {
		name       string
		retryAfter time.Duration
		want       string
	}{
		{"fractional rounds up", 1500 * time.Millisecond, "2"},
		{"no usable wait falls back to 60", 0, "60"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, _ := serveSinkFailure(t, &SinkError{Status: 429, RetryAfter: tc.retryAfter})
			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429", rec.Code)
			}
			if got := rec.Header().Get("Retry-After"); got != tc.want {
				t.Fatalf("Retry-After = %q, want %q", got, tc.want)
			}
			want := "Too many bug reports. Try again in " + tc.want + " seconds."
			if got := problemDetailOf(t, rec); got != want {
				t.Fatalf("detail = %q, want %q", got, want)
			}
		})
	}
}

func TestSinkErrorKeyRefusalsAre503(t *testing.T) {
	const want = "Bug reporting is not configured on this server."
	for _, status := range []int{401, 403, 409} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			rec, _ := serveSinkFailure(t, &SinkError{Status: status})
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", rec.Code)
			}
			if got := problemDetailOf(t, rec); got != want {
				t.Fatalf("detail = %q, want %q", got, want)
			}
			if got := rec.Header().Get("Retry-After"); got != "" {
				t.Fatalf("Retry-After = %q, want none", got)
			}
		})
	}
}

func TestSinkErrorOtherwiseIs502(t *testing.T) {
	const want = "The report could not be filed. Copy it and try again."
	cases := []struct {
		name    string
		err     error
		wantLog string
	}{
		{"400", &SinkError{Status: 400}, ""},
		{"422", &SinkError{Status: 422}, ""},
		{"500", &SinkError{Status: 500}, "status=500"},
		{"plain error", errors.New("dial tcp: connection refused"), "connection refused"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, logText := serveSinkFailure(t, tc.err)
			if rec.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, want 502", rec.Code)
			}
			if got := problemDetailOf(t, rec); got != want {
				t.Fatalf("detail = %q, want %q", got, want)
			}
			if tc.wantLog != "" && !strings.Contains(logText, tc.wantLog) {
				t.Fatalf("log does not contain %q: %s", tc.wantLog, logText)
			}
			if strings.Contains(logText, "reporter@example.test") {
				t.Fatalf("log holds the reporter's email: %s", logText)
			}
		})
	}
}

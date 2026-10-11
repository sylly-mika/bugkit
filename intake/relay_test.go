package intake_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"

	"github.com/sylly-mika/bugkit"
	"github.com/sylly-mika/bugkit/intake"
)

// browserForm builds the multipart form a browser posts to the handler.
func browserForm(t *testing.T) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fields := map[string]string{
		"description": "Save fails",
		"impact":      "workaround",
		"area":        "/tasks/1",
		"diagnostics": `{"b":2}`,
		"version":     "v9",
		"viewport":    "800x600",
		"request_id":  "req-1",
	}
	for _, k := range []string{"description", "impact", "area", "diagnostics", "version", "viewport", "request_id"} {
		if err := w.WriteField(k, fields[k]); err != nil {
			t.Fatalf("write field %s: %v", k, err)
		}
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="screenshot"; filename="shot.png"`)
	h.Set("Content-Type", "image/png")
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatalf("create screenshot part: %v", err)
	}
	if _, err := part.Write([]byte("\x89PNG\r\n\x1a\npixels")); err != nil {
		t.Fatalf("write screenshot: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, w.FormDataContentType()
}

// relayHandler is bugkit.Handler with the intake client as its Sink, logging
// into buf.
func relayHandler(url string, buf *bytes.Buffer) http.Handler {
	return bugkit.Handler(bugkit.Config{
		Sink: intake.New(url, testKey()),
		Who: func(*http.Request) (bugkit.Reporter, bool) {
			return bugkit.Reporter{ID: "u-7", Name: "Ann Lee", Email: "ann@example.test"}, true
		},
		Limiter: bugkit.NewRateLimiter(10, time.Hour),
		Limits:  bugkit.DefaultLimits(),
		Logger:  slog.New(slog.NewTextHandler(buf, nil)),
	})
}

// postBrowserForm posts the browser form through the relay and returns the
// response.
func postBrowserForm(t *testing.T, url string, buf *bytes.Buffer) *httptest.ResponseRecorder {
	t.Helper()
	body, contentType := browserForm(t)
	req := httptest.NewRequest("POST", "/bug-reports", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "TestBrowser/1.0")
	rec := httptest.NewRecorder()
	relayHandler(url, buf).ServeHTTP(rec, req)
	return rec
}

func detailOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("response body is not a problem: %v", err)
	}
	return p.Detail
}

func TestRelayFilesTheReport(t *testing.T) {
	f, url := newFakeIntake(t)
	var logBuf bytes.Buffer
	rec := postBrowserForm(t, url, &logBuf)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body %s", rec.Code, rec.Body.String())
	}
	var res bugkit.Result
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("body is not a result: %v", err)
	}
	if res != (bugkit.Result{ID: "0192f0c4-0000-7000-8000-000000000001", Number: 7}) {
		t.Fatalf("result = %+v", res)
	}

	g := onlyRequest(t, f)
	want := []string{"description", "impact", "area", "diagnostics", "version", "viewport",
		"user_agent", "request_id", "reporter_name", "reporter_email", "screenshot"}
	if got := partNames(g.Parts); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("parts = %v, want %v", got, want)
	}
	if p, _ := findPart(g.Parts, "user_agent"); string(p.Value) != "TestBrowser/1.0" {
		t.Fatalf("user_agent = %q", p.Value)
	}
	if p, _ := findPart(g.Parts, "reporter_name"); string(p.Value) != "Ann Lee" {
		t.Fatalf("reporter_name = %q", p.Value)
	}
	if p, _ := findPart(g.Parts, "reporter_email"); string(p.Value) != "ann@example.test" {
		t.Fatalf("reporter_email = %q", p.Value)
	}
	if p, _ := findPart(g.Parts, "screenshot"); string(p.Value) != "\x89PNG\r\n\x1a\npixels" {
		t.Fatalf("screenshot bytes differ from the browser's")
	}
}

func TestRelayIntake429ReachesTheBrowser(t *testing.T) {
	f, url := newFakeIntake(t)
	f.respond = func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
		w.Header().Set("Retry-After", "90")
		w.WriteHeader(http.StatusTooManyRequests)
	}
	var logBuf bytes.Buffer
	rec := postBrowserForm(t, url, &logBuf)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "90" {
		t.Fatalf("Retry-After = %q, want 90", got)
	}
	want := "Too many bug reports. Try again in 90 seconds."
	if got := detailOf(t, rec); got != want {
		t.Fatalf("detail = %q, want %q", got, want)
	}
}

func TestRelayRefusedKeyIs503(t *testing.T) {
	f, url := newFakeIntake(t)
	f.respond = func(w http.ResponseWriter, _ *http.Request, _ gotRequest) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"status":401,"detail":"A valid intake key is required"}`)
	}
	var logBuf bytes.Buffer
	rec := postBrowserForm(t, url, &logBuf)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	const want = "Bug reporting is not configured on this server."
	if got := detailOf(t, rec); got != want {
		t.Fatalf("detail = %q, want %q", got, want)
	}
	body := rec.Body.String()
	if strings.Contains(body, "intake key") || strings.Contains(body, testKey()) {
		t.Fatalf("the browser's body names the intake key or holds it: <redacted>")
	}
	logText := logBuf.String()
	if !strings.Contains(logText, "status=401") {
		t.Fatalf("log does not contain status=401: %s", logText)
	}
	if strings.Contains(logText, testKey()) {
		t.Fatalf("the log holds the key: <redacted>")
	}
}

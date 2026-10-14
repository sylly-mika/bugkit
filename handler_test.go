package bugkit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// pngBytes is the shortest blob the handler accepts as a screenshot: the 8-byte
// signature plus payload.
var pngBytes = []byte("\x89PNG\r\n\x1a\npretend")

// pngOfSize returns a PNG-signed blob of exactly n bytes.
func pngOfSize(n int) []byte {
	b := make([]byte, n)
	copy(b, "\x89PNG\r\n\x1a\n")
	for i := 8; i < n; i++ {
		b[i] = 'x'
	}
	return b
}

// validParts is what a well-formed browser submission carries. Tests copy it
// and change the one field they are about.
func validParts() map[string]string {
	return map[string]string{
		"description": "The plans list returns nothing after I pick a site.",
		"impact":      "blocks",
		"area":        "/sites/123/plans",
		"diagnostics": `{"entries":[{"method":"GET","path":"/plans","status":500,"request_id":"r1","at":1}]}`,
		"version":     "abc1234",
		"viewport":    "1440x900",
		"request_id":  "req-1",
	}
}

func multipartBody(t *testing.T, fields map[string]string, screenshot []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatalf("write field %s: %v", k, err)
		}
	}
	if screenshot != nil {
		part, err := w.CreateFormFile("screenshot", "shot.png")
		if err != nil {
			t.Fatalf("create screenshot part: %v", err)
		}
		if _, err := part.Write(screenshot); err != nil {
			t.Fatalf("write screenshot: %v", err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, w.FormDataContentType()
}

// fakeSink records what the handler submits. It takes its own mutex, as the
// Sink contract requires of the app's sinks.
type fakeSink struct {
	mu          sync.Mutex
	calls       int
	who         Reporter
	got         Report
	deadline    time.Time
	hasDeadline bool
	res         Result
	err         error
}

func newFakeSink() *fakeSink {
	return &fakeSink{res: Result{ID: "t-1", Number: 7}}
}

func (s *fakeSink) Submit(ctx context.Context, who Reporter, r Report) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.who = who
	s.got = r
	s.deadline, s.hasDeadline = ctx.Deadline()
	return s.res, s.err
}

func whoMiky(*http.Request) (Reporter, bool) {
	return Reporter{ID: "u-1", Name: "Miky", Email: "miky@ino.lv"}, true
}

const (
	reportPath   = "/api/v1/bug-reports"
	browserAgent = "Mozilla/5.0 (X11; Linux x86_64)"
)

// serve runs one raw request through the handler and returns the recorder.
func serve(cfg Config, body io.Reader, contentType, userAgent string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, reportPath, body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", userAgent)
	rec := httptest.NewRecorder()
	Handler(cfg).ServeHTTP(rec, req)
	return rec
}

// post sends one multipart report through the handler.
func post(t *testing.T, cfg Config, fields map[string]string, shot []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, ct := multipartBody(t, fields, shot)
	return serve(cfg, body, ct, browserAgent)
}

// assertProblem checks the status, the content type and the detail of a
// problem body, the parts the panel shows.
func assertProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, detail string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d\n%s", rec.Code, status, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=UTF-8" {
		t.Errorf("content type = %q", ct)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode problem: %v\n%s", err, rec.Body.String())
	}
	if got["detail"] != detail {
		t.Fatalf("detail = %v, want %q\n%s", got["detail"], detail, rec.Body.String())
	}
}

func TestHandlerFilesAReport(t *testing.T) {
	sink := newFakeSink()
	cfg := Config{Sink: sink, Who: whoMiky}
	fields := validParts()
	fields["description"] = "  The plans list returns nothing after I pick a site.\n"
	rec := post(t, cfg, fields, pngBytes)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=UTF-8" {
		t.Errorf("content type = %q", ct)
	}
	var res Result
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode body: %v\n%s", err, rec.Body.String())
	}
	if res != (Result{ID: "t-1", Number: 7}) {
		t.Errorf("body = %+v, want {t-1 7}", res)
	}
	if sink.calls != 1 {
		t.Fatalf("sink calls = %d, want 1", sink.calls)
	}
	g := sink.got
	if g.Description != "The plans list returns nothing after I pick a site." {
		t.Errorf("Description = %q", g.Description)
	}
	if g.Impact != "blocks" || g.Area != "/sites/123/plans" || g.Version != "abc1234" ||
		g.Viewport != "1440x900" || g.RequestID != "req-1" {
		t.Errorf("report fields = %+v", g)
	}
	if !bytes.Equal(g.Screenshot, pngBytes) {
		t.Errorf("Screenshot = %q, want %q", g.Screenshot, pngBytes)
	}
}

func TestHandlerPassesKindAndSummary(t *testing.T) {
	sink := newFakeSink()
	fields := validParts()
	fields["kind"] = "feature"
	fields["summary"] = "  Export the plan list \n"
	rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if sink.got.Kind != "feature" {
		t.Errorf("Kind = %q, want feature", sink.got.Kind)
	}
	if sink.got.Summary != "Export the plan list" {
		t.Errorf("Summary = %q, want %q", sink.got.Summary, "Export the plan list")
	}
}

func TestHandlerTakesAnOldReportAsABug(t *testing.T) {
	emptyKind := validParts()
	emptyKind["kind"] = ""
	for name, fields := range map[string]map[string]string{"no kind part": validParts(), "empty kind": emptyKind} {
		sink := newFakeSink()
		rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil)

		if rec.Code != http.StatusCreated {
			t.Fatalf("%s: status = %d, want 201\n%s", name, rec.Code, rec.Body.String())
		}
		if sink.got.Kind != "bug" {
			t.Errorf("%s: Kind = %q, want bug", name, sink.got.Kind)
		}
		if sink.got.Summary != "" {
			t.Errorf("%s: Summary = %q, want empty", name, sink.got.Summary)
		}
	}
}

func TestHandlerTakesTheReporterFromWho(t *testing.T) {
	sink := newFakeSink()
	fields := validParts()
	fields["reporter_name"] = "Mallory"
	fields["reporter_email"] = "mallory@evil.test"
	fields["user_agent"] = "FakeAgent/1"
	fields["extra"] = "ignored"
	rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if sink.who != (Reporter{ID: "u-1", Name: "Miky", Email: "miky@ino.lv"}) {
		t.Errorf("reporter = %+v, want the one Who returned", sink.who)
	}
	if sink.got.UserAgent != browserAgent {
		t.Errorf("UserAgent = %q, want the request header", sink.got.UserAgent)
	}
}

func TestHandlerTruncatesTheUserAgent(t *testing.T) {
	sink := newFakeSink()
	body, ct := multipartBody(t, validParts(), nil)
	rec := serve(Config{Sink: sink, Who: whoMiky}, body, ct, strings.Repeat("é", 300))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if sink.got.UserAgent != strings.Repeat("é", 256) {
		t.Errorf("UserAgent has %d runes, want 256 of é", len([]rune(sink.got.UserAgent)))
	}
}

func TestHandlerPassesDiagnosticsThroughUntouched(t *testing.T) {
	sink := newFakeSink()
	const diag = "{ \"b\": 1,\n  \"a\": [2] }\n"
	fields := validParts()
	fields["diagnostics"] = diag
	rec := post(t, Config{Sink: sink, Who: whoMiky}, fields, nil)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if string(sink.got.Diagnostics) != diag {
		t.Errorf("Diagnostics = %q, want %q", sink.got.Diagnostics, diag)
	}
}

func TestHandlerWithoutAScreenshotSubmitsTextOnly(t *testing.T) {
	sink := newFakeSink()
	cfg := Config{Sink: sink, Who: whoMiky}

	// (a) no screenshot part at all
	rec := post(t, cfg, validParts(), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("no part: status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	// (b) a screenshot part of zero bytes is the same as no part
	rec = post(t, cfg, validParts(), []byte{})
	if rec.Code != http.StatusCreated {
		t.Fatalf("empty part: status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if sink.calls != 2 {
		t.Fatalf("sink calls = %d, want 2", sink.calls)
	}
	if len(sink.got.Screenshot) != 0 {
		t.Errorf("Screenshot has %d bytes, want none", len(sink.got.Screenshot))
	}
}

func TestHandlerSubmitsWithA30SecondDeadline(t *testing.T) {
	sink := newFakeSink()
	start := time.Now()
	rec := post(t, Config{Sink: sink, Who: whoMiky}, validParts(), nil)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201\n%s", rec.Code, rec.Body.String())
	}
	if !sink.hasDeadline {
		t.Fatal("the sink got a context with no deadline")
	}
	if sink.deadline.Before(start.Add(29*time.Second)) || sink.deadline.After(time.Now().Add(30*time.Second)) {
		t.Errorf("deadline = %v, want 30 seconds after the request", sink.deadline.Sub(start))
	}
}

func TestRefusal401WhenThereIsNoIdentity(t *testing.T) {
	sink := newFakeSink()
	none := func(*http.Request) (Reporter, bool) { return Reporter{}, false }

	assertProblem(t, post(t, Config{Sink: sink, Who: none}, validParts(), nil), http.StatusUnauthorized, "Not authenticated.")
	assertProblem(t, post(t, Config{Sink: sink}, validParts(), nil), http.StatusUnauthorized, "Not authenticated.")
	if sink.calls != 0 {
		t.Fatalf("sink calls = %d, want 0", sink.calls)
	}
}

func TestRefusalOrderBeforeTheBody(t *testing.T) {
	sink := newFakeSink()
	none := func(*http.Request) (Reporter, bool) { return Reporter{}, false }

	// (a) no identity and no sink: identity is checked first
	rec := serve(Config{Who: none}, strings.NewReader("hello"), "text/plain", browserAgent)
	assertProblem(t, rec, http.StatusUnauthorized, "Not authenticated.")

	// (b) no sink: 503 before the body is read
	rec = serve(Config{Who: whoMiky}, strings.NewReader("hello"), "text/plain", browserAgent)
	assertProblem(t, rec, http.StatusServiceUnavailable, "Bug reporting is not configured on this server.")

	// (c) the limiter is spent: 429 before the body is read
	lim := NewRateLimiter(1, time.Hour)
	lim.Allow("u-1", time.Now())
	rec = serve(Config{Sink: sink, Who: whoMiky, Limiter: lim}, strings.NewReader("hello"), "text/plain", browserAgent)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("spent limiter: status = %d, want 429\n%s", rec.Code, rec.Body.String())
	}
	ra := rec.Header().Get("Retry-After")
	n, err := strconv.Atoi(ra)
	if err != nil || n < 1 {
		t.Fatalf("spent limiter: Retry-After = %q, want a positive number of seconds", ra)
	}
	assertProblem(t, rec, http.StatusTooManyRequests, fmt.Sprintf("Too many bug reports. Try again in %d seconds.", n))
	if sink.calls != 0 {
		t.Fatalf("sink calls = %d, want 0", sink.calls)
	}
}

func TestRefusal429AfterTheCap(t *testing.T) {
	sink := newFakeSink()
	cfg := Config{Sink: sink, Who: whoMiky, Limiter: NewRateLimiter(2, time.Hour)}
	for i := 1; i <= 2; i++ {
		if rec := post(t, cfg, validParts(), nil); rec.Code != http.StatusCreated {
			t.Fatalf("report %d: status = %d, want 201", i, rec.Code)
		}
	}

	rec := post(t, cfg, validParts(), nil)
	n, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || n < 3599 || n > 3601 {
		t.Fatalf("Retry-After = %q, want about 3600", rec.Header().Get("Retry-After"))
	}
	assertProblem(t, rec, http.StatusTooManyRequests, fmt.Sprintf("Too many bug reports. Try again in %d seconds.", n))
	if sink.calls != 2 {
		t.Fatalf("sink calls = %d, want 2", sink.calls)
	}
}

func TestRefusal429CountsRefusedReports(t *testing.T) {
	sink := newFakeSink()
	cfg := Config{Sink: sink, Who: whoMiky, Limiter: NewRateLimiter(1, time.Hour)}

	blank := validParts()
	blank["description"] = ""
	assertProblem(t, post(t, cfg, blank, nil), http.StatusUnprocessableEntity, "A description is required.")

	rec := post(t, cfg, validParts(), nil)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second report: status = %d, want 429\n%s", rec.Code, rec.Body.String())
	}
	if sink.calls != 0 {
		t.Fatalf("sink calls = %d, want 0", sink.calls)
	}
}

func TestRefusal400OnAMalformedBody(t *testing.T) {
	sink := newFakeSink()
	cfg := Config{Sink: sink, Who: whoMiky}
	const detail = "The report body is not a readable multipart form."

	assertProblem(t, serve(cfg, strings.NewReader("hello"), "text/plain", browserAgent), http.StatusBadRequest, detail)
	assertProblem(t, serve(cfg, strings.NewReader("--abc\r\nnot a part"), "multipart/form-data; boundary=xyz", browserAgent), http.StatusBadRequest, detail)
	if sink.calls != 0 {
		t.Fatalf("sink calls = %d, want 0", sink.calls)
	}
}

func TestRefusal502WhenTheSinkFails(t *testing.T) {
	const detail = "The report could not be filed. Copy it and try again."

	var buf bytes.Buffer
	sink := newFakeSink()
	sink.err = errors.New("upstream down")
	cfg := Config{Sink: sink, Who: whoMiky, Logger: slog.New(slog.NewTextHandler(&buf, nil))}
	assertProblem(t, post(t, cfg, validParts(), nil), http.StatusBadGateway, detail)
	logs := buf.String()
	for _, want := range []string{"bugkit: submission failed", "reporter=u-1", "upstream down"} {
		if !strings.Contains(logs, want) {
			t.Errorf("log lacks %q:\n%s", want, logs)
		}
	}
	for _, secret := range []string{"miky@ino.lv", "The plans list"} {
		if strings.Contains(logs, secret) {
			t.Errorf("log holds %q:\n%s", secret, logs)
		}
	}

	buf.Reset()
	sink = newFakeSink()
	sink.err = &SinkError{Status: 500}
	cfg = Config{Sink: sink, Who: whoMiky, Logger: slog.New(slog.NewTextHandler(&buf, nil))}
	assertProblem(t, post(t, cfg, validParts(), nil), http.StatusBadGateway, detail)
	if !strings.Contains(buf.String(), "bugkit: intake answered 500") {
		t.Errorf("log lacks the sink status:\n%s", buf.String())
	}
}

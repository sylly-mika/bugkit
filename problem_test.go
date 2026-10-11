package bugkit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProblemBodyShape(t *testing.T) {
	none := func(*http.Request) (Reporter, bool) { return Reporter{}, false }
	req := httptest.NewRequest(http.MethodPost, "/api/v1/bug-reports?from=test", strings.NewReader("x"))
	rec := httptest.NewRecorder()
	Handler(Config{Sink: newFakeSink(), Who: none}).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=UTF-8" {
		t.Errorf("content type = %q", ct)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode problem: %v\n%s", err, rec.Body.String())
	}
	want := map[string]any{
		"type":     "about:blank",
		"title":    "Unauthorized",
		"status":   float64(401),
		"detail":   "Not authenticated.",
		"instance": "/api/v1/bug-reports",
	}
	if len(got) != len(want) {
		t.Errorf("body has %d keys, want %d: %v", len(got), len(want), got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}

	rec = post(t, Config{Sink: newFakeSink(), Who: whoMiky}, map[string]string{
		"description": "d", "impact": "urgent", "area": "/a", "diagnostics": "{}",
	}, nil)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("422 status = %d, want 422", rec.Code)
	}
	var unprocessable map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &unprocessable); err != nil {
		t.Fatalf("decode 422 problem: %v", err)
	}
	if unprocessable["title"] != "Unprocessable Entity" {
		t.Errorf("422 title = %v, want Unprocessable Entity", unprocessable["title"])
	}
}

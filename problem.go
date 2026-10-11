package bugkit

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// problemDetail is the body of every refusal. Its fields carry no omitempty on
// purpose: the writer always sets all five.
type problemDetail struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail"`
	Instance string `json:"instance"`
}

// writeProblem emits the error body. The content type is application/json, not
// application/problem+json: the panel's parser keys on application/json and
// degrades to "HTTP error" without it.
func writeProblem(w http.ResponseWriter, r *http.Request, log *slog.Logger, status int, detail string) {
	if detail == "" {
		detail = http.StatusText(status)
	}
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(problemDetail{
		Type:     "about:blank",
		Title:    http.StatusText(status),
		Status:   status,
		Detail:   detail,
		Instance: r.URL.Path,
	}); err != nil {
		log.Error("bugkit: writing the error body failed", "error", err.Error())
	}
}

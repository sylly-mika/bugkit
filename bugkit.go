// Package bugkit serves a bug-report endpoint for a web app: it reads the
// browser's multipart report, applies the field caps and a per-reporter rate
// limit, and hands the report to a Sink, which files it somewhere else.
package bugkit

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Reporter is who filed the report. The app's Who callback fills it from its
// own session; the form never does.
type Reporter struct {
	ID, Name, Email string
}

// BugKinds lists the values a report's kind may take. A report without a kind
// is a bug.
var BugKinds = []string{"bug", "feature"}

type Report struct {
	Kind, Summary, Description, Impact, Area string
	Diagnostics                              json.RawMessage
	Version, Viewport, RequestID, UserAgent  string
	Screenshot                               []byte
}

type Result struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
}

type Sink interface {
	Submit(ctx context.Context, who Reporter, r Report) (Result, error)
}

// SinkError is a sink's refusal by status. It never carries a response body
// or a credential.
type SinkError struct {
	Status     int
	RetryAfter time.Duration
}

func (e *SinkError) Error() string { return fmt.Sprintf("bugkit: intake answered %d", e.Status) }

type Limits struct {
	Summary, Description, Area, Version, Viewport, RequestID, UserAgent int
	Diagnostics, Screenshot                                             int64
}

// DefaultLimits returns the caps for a report: the text fields in characters
// (runes), diagnostics and the screenshot in bytes.
func DefaultLimits() Limits {
	return Limits{
		Summary:     200,
		Description: 5000,
		Area:        512,
		Version:     128,
		Viewport:    64,
		RequestID:   128,
		UserAgent:   256,
		Diagnostics: 32768,
		Screenshot:  5242880,
	}
}

type Config struct {
	Sink    Sink
	Who     func(*http.Request) (Reporter, bool)
	Limiter *RateLimiter
	Limits  Limits
	Logger  *slog.Logger
}

// ListPageSize is the page size the intake client asks for.
const ListPageSize = 20

// ReportSummary is one report in the intake's list.
type ReportSummary struct {
	Number         int       `json:"number"`
	Title          string    `json:"title"`
	Status         string    `json:"status"`
	StatusCategory string    `json:"status_category"`
	ReporterName   *string   `json:"reporter_name"`
	ReportedAt     time.Time `json:"reported_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// PageMeta describes where a page sits in the list.
type PageMeta struct {
	Page       int `json:"page"`
	PerPage    int `json:"per_page"`
	Total      int `json:"total"`
	TotalPages int `json:"total_pages"`
}

// ReportPage is one page of the intake's list.
type ReportPage struct {
	Data []ReportSummary `json:"data"`
	Meta PageMeta        `json:"meta"`
}

// Lister lists the reports filed through the intake, one page at a time.
type Lister interface {
	List(ctx context.Context, page int) (ReportPage, error)
}

// ListConfig configures ListHandler. Who and Lister are required; Logger
// defaults to slog.Default().
type ListConfig struct {
	Lister Lister
	Who    func(*http.Request) (Reporter, bool)
	Logger *slog.Logger
}

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

type Report struct {
	Description, Impact, Area               string
	Diagnostics                             json.RawMessage
	Version, Viewport, RequestID, UserAgent string
	Screenshot                              []byte
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
	Description, Area, Version, Viewport, RequestID, UserAgent int
	Diagnostics, Screenshot                                    int64
}

// DefaultLimits returns the caps for a report: the text fields in characters
// (runes), diagnostics and the screenshot in bytes.
func DefaultLimits() Limits {
	return Limits{
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

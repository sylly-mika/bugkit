package bugkit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

// submitTimeout bounds the sink's work. The sink runs on the request goroutine,
// so a hung upstream would otherwise hold the request open until the client
// gives up.
const submitTimeout = 30 * time.Second

// bodySlack is the room a multipart body has beyond the screenshot cap for the
// text parts and the framing.
const bodySlack = 1 << 20

// Handler serves a bug report: POST a multipart form, get 201 with the sink's
// result. It writes its own response and never returns an error.
//
// The checks run in this order, and each refusal stops the request: identity,
// the sink, the reporter's rate limit, then the body. A refused report still
// uses one attempt of the limit.
func Handler(cfg Config) http.Handler {
	cfg.Limits = cfg.Limits.withDefaults()
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	lim := cfg.Limits
	log := cfg.Logger

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cfg.Who == nil {
			writeProblem(w, r, log, http.StatusUnauthorized, "Not authenticated.")
			return
		}
		reporter, ok := cfg.Who(r)
		if !ok {
			writeProblem(w, r, log, http.StatusUnauthorized, "Not authenticated.")
			return
		}
		if cfg.Sink == nil {
			writeProblem(w, r, log, http.StatusServiceUnavailable, "Bug reporting is not configured on this server.")
			return
		}
		if ok, wait := cfg.Limiter.Allow(reporter.ID, time.Now()); !ok {
			seconds := int(wait.Seconds()) + 1
			w.Header().Set("Retry-After", strconv.Itoa(seconds))
			writeProblem(w, r, log, http.StatusTooManyRequests,
				fmt.Sprintf("Too many bug reports. Try again in %d seconds.", seconds))
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, lim.Screenshot+bodySlack)
		report, err := parseReport(r, lim)
		if err != nil {
			var ref refusal
			if errors.As(err, &ref) {
				writeProblem(w, r, log, ref.status, ref.detail)
				return
			}
			writeProblem(w, r, log, http.StatusBadRequest, "The report body is not a readable multipart form.")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), submitTimeout)
		defer cancel()

		res, err := cfg.Sink.Submit(ctx, reporter, report)
		if err != nil {
			log.Error("bugkit: submission failed", "error", err.Error(), "reporter", reporter.ID)
			writeProblem(w, r, log, http.StatusBadGateway, "The report could not be filed. Copy it and try again.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(res); err != nil {
			log.Error("bugkit: writing the response failed", "error", err.Error())
		}
	})
}

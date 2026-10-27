package bugkit

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
)

// ListHandler serves one page of the site's reports: GET ?page=n answers 200
// with the ReportPage as JSON. A page that is not a whole number of 1 or more
// is page 1. The checks run in this order: identity, the Lister, then the list.
func ListHandler(cfg ListConfig) http.Handler {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	log := cfg.Logger

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cfg.Who == nil {
			writeProblem(w, r, log, http.StatusUnauthorized, "Not authenticated.")
			return
		}
		if _, ok := cfg.Who(r); !ok {
			writeProblem(w, r, log, http.StatusUnauthorized, "Not authenticated.")
			return
		}
		if cfg.Lister == nil {
			writeProblem(w, r, log, http.StatusServiceUnavailable, "Bug reporting is not configured on this server.")
			return
		}

		page := 1
		if n, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && n >= 1 {
			page = n
		}

		ctx, cancel := context.WithTimeout(r.Context(), submitTimeout)
		defer cancel()

		result, err := cfg.Lister.List(ctx, page)
		if err != nil {
			var se *SinkError
			if errors.As(err, &se) {
				log.Error("bugkit: listing failed", "error", se.Error(), "status", se.Status)
				switch se.Status {
				case http.StatusUnauthorized, http.StatusForbidden, http.StatusConflict:
					writeProblem(w, r, log, http.StatusServiceUnavailable, "Bug reporting is not configured on this server.")
					return
				}
			} else {
				log.Error("bugkit: listing failed", "error", err.Error())
			}
			writeProblem(w, r, log, http.StatusBadGateway, "The reports could not be loaded.")
			return
		}

		if result.Data == nil {
			result.Data = []ReportSummary{}
		}
		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(result); err != nil {
			log.Error("bugkit: writing the response failed", "error", err.Error())
		}
	})
}

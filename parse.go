package bugkit

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"
)

// refusal is a status and the message the panel will show for it.
type refusal struct {
	status int
	detail string
}

func (e refusal) Error() string { return e.detail }

var validImpacts = map[string]bool{"blocks": true, "workaround": true, "cosmetic": true}

// pngSignature is checked because the app's sink may store the screenshot and
// serve it under its own domain: without this the endpoint would host whatever
// an authenticated caller uploads.
var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// withDefaults replaces every field that is not positive with its
// DefaultLimits value, so the zero Limits means the default caps.
func (l Limits) withDefaults() Limits {
	d := DefaultLimits()
	if l.Summary <= 0 {
		l.Summary = d.Summary
	}
	if l.Description <= 0 {
		l.Description = d.Description
	}
	if l.Area <= 0 {
		l.Area = d.Area
	}
	if l.Version <= 0 {
		l.Version = d.Version
	}
	if l.Viewport <= 0 {
		l.Viewport = d.Viewport
	}
	if l.RequestID <= 0 {
		l.RequestID = d.RequestID
	}
	if l.UserAgent <= 0 {
		l.UserAgent = d.UserAgent
	}
	if l.Diagnostics <= 0 {
		l.Diagnostics = d.Diagnostics
	}
	if l.Screenshot <= 0 {
		l.Screenshot = d.Screenshot
	}
	return l
}

// parseReport reads and checks the multipart form. Every refusal is a refusal
// value; any other error is a body that could not be read as a form.
func parseReport(r *http.Request, lim Limits) (Report, error) {
	var mbe *http.MaxBytesError
	if err := r.ParseMultipartForm(lim.Screenshot); err != nil {
		if errors.As(err, &mbe) {
			return Report{}, refusal{http.StatusRequestEntityTooLarge,
				fmt.Sprintf("The report is larger than %s.", sizeText(lim.Screenshot+bodySlack))}
		}
		return Report{}, refusal{http.StatusBadRequest, "The report body is not a readable multipart form."}
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	kind := strings.TrimSpace(r.FormValue("kind"))
	if kind == "" {
		kind = "bug"
	}
	if !slices.Contains(BugKinds, kind) {
		return Report{}, refusal{http.StatusUnprocessableEntity, "Kind must be bug or feature."}
	}
	summary := strings.TrimSpace(r.FormValue("summary"))
	if utf8.RuneCountInString(summary) > lim.Summary {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Summary must be at most %d characters.", lim.Summary)}
	}
	report := Report{
		Kind:        kind,
		Summary:     summary,
		Description: strings.TrimSpace(r.FormValue("description")),
		Impact:      strings.TrimSpace(r.FormValue("impact")),
		Area:        strings.TrimSpace(r.FormValue("area")),
	}
	if report.Summary == "" && report.Description == "" {
		return Report{}, refusal{http.StatusUnprocessableEntity, "A summary or a description is required."}
	}
	if utf8.RuneCountInString(report.Description) > lim.Description {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Description must be at most %d characters.", lim.Description)}
	}
	if !validImpacts[report.Impact] {
		return Report{}, refusal{http.StatusUnprocessableEntity, "Impact must be one of blocks, workaround or cosmetic."}
	}
	if report.Area == "" {
		return Report{}, refusal{http.StatusUnprocessableEntity, "An area is required."}
	}
	// The area is a route path. A full URL would be stored as one, and the
	// intake would keep it as the area of the report.
	if !strings.HasPrefix(report.Area, "/") {
		return Report{}, refusal{http.StatusUnprocessableEntity, `Area must be a route path starting with "/".`}
	}
	if utf8.RuneCountInString(report.Area) > lim.Area {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Area must be at most %d characters.", lim.Area)}
	}

	// Diagnostics are never trimmed: they are stored as the browser sent them.
	diagnostics := r.FormValue("diagnostics")
	if int64(len(diagnostics)) > lim.Diagnostics {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Diagnostics must be at most %s.", sizeText(lim.Diagnostics))}
	}
	if !json.Valid([]byte(diagnostics)) {
		return Report{}, refusal{http.StatusUnprocessableEntity, "Diagnostics must be JSON."}
	}
	report.Diagnostics = json.RawMessage(diagnostics)

	report.Version = strings.TrimSpace(r.FormValue("version"))
	if utf8.RuneCountInString(report.Version) > lim.Version {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Version must be at most %d characters.", lim.Version)}
	}
	report.Viewport = strings.TrimSpace(r.FormValue("viewport"))
	if utf8.RuneCountInString(report.Viewport) > lim.Viewport {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Viewport must be at most %d characters.", lim.Viewport)}
	}
	report.RequestID = strings.TrimSpace(r.FormValue("request_id"))
	if utf8.RuneCountInString(report.RequestID) > lim.RequestID {
		return Report{}, refusal{http.StatusUnprocessableEntity,
			fmt.Sprintf("Request id must be at most %d characters.", lim.RequestID)}
	}

	shot, err := readScreenshot(r, lim)
	if err != nil {
		return Report{}, err
	}
	report.Screenshot = shot

	// The user agent is a request header, not a form field, so it is cut to
	// the cap rather than refused.
	report.UserAgent = truncateRunes(r.UserAgent(), lim.UserAgent)
	return report, nil
}

func truncateRunes(v string, limit int) string {
	if r := []rune(v); len(r) > limit {
		return string(r[:limit])
	}
	return v
}

// readScreenshot returns the screenshot bytes, or nil when the report has none.
// An absent part and an empty part both mean no screenshot.
func readScreenshot(r *http.Request, lim Limits) ([]byte, error) {
	file, header, err := r.FormFile("screenshot")
	if errors.Is(err, http.ErrMissingFile) {
		return nil, nil
	}
	if err != nil {
		return nil, refusal{http.StatusBadRequest, "The screenshot part could not be read."}
	}
	defer file.Close()

	if header.Size == 0 {
		return nil, nil
	}
	if header.Size > lim.Screenshot {
		return nil, refusal{http.StatusRequestEntityTooLarge,
			fmt.Sprintf("The screenshot is larger than %s.", sizeText(lim.Screenshot))}
	}
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(io.LimitReader(file, lim.Screenshot+1)); err != nil {
		return nil, refusal{http.StatusBadRequest, "The screenshot could not be read."}
	}
	if int64(buf.Len()) > lim.Screenshot {
		return nil, refusal{http.StatusRequestEntityTooLarge,
			fmt.Sprintf("The screenshot is larger than %s.", sizeText(lim.Screenshot))}
	}
	if !bytes.HasPrefix(buf.Bytes(), pngSignature) {
		return nil, refusal{http.StatusUnprocessableEntity, "Screenshot must be a PNG image."}
	}
	return buf.Bytes(), nil
}

// sizeText names a byte count in the largest unit it divides into exactly.
func sizeText(n int64) string {
	switch {
	case n%(1<<20) == 0:
		return fmt.Sprintf("%d MiB", n>>20)
	case n%(1<<10) == 0:
		return fmt.Sprintf("%d KiB", n>>10)
	default:
		return fmt.Sprintf("%d bytes", n)
	}
}

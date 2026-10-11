// Package intake is a bugkit.Sink that files reports on an ino-tasks intake
// route (POST /api/intake/v1/bug-reports) with the app's intake key.
package intake

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"github.com/sylly-mika/bugkit"
)

// Client files reports on the intake route at URL with Key. Its methods are
// safe for concurrent use. Key is written only to the Authorization header.
type Client struct {
	URL, Key string
	HTTP     *http.Client
}

var _ bugkit.Sink = (*Client)(nil)

// New returns a Client for the intake route url, with the app's intake key.
// It never follows a redirect: a 3xx is answered as a SinkError, so the key
// is never sent to a second URL.
func New(url, key string) *Client {
	return &Client{
		URL: url,
		Key: key,
		HTTP: &http.Client{
			Timeout:       30 * time.Second,
			CheckRedirect: noRedirect,
		},
	}
}

// Submit files one report. A 201 answer is the report's result. Every other
// answer is a *bugkit.SinkError, and a transport failure is any other error.
func (c *Client) Submit(ctx context.Context, who bugkit.Reporter, r bugkit.Report) (bugkit.Result, error) {
	body, contentType, err := form(who, r)
	if err != nil {
		return bugkit.Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, body)
	if err != nil {
		return bugkit.Result{}, fmt.Errorf("bugkit: intake request failed: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Key)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")

	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return bugkit.Result{}, fmt.Errorf("bugkit: intake request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusCreated {
		var res bugkit.Result
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&res); err != nil || res.ID == "" {
			return bugkit.Result{}, errors.New("bugkit: intake answered 201 with an unreadable body")
		}
		return res, nil
	}

	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	se := &bugkit.SinkError{Status: resp.StatusCode}
	if resp.StatusCode == http.StatusTooManyRequests {
		se.RetryAfter = retryAfter(resp.Header.Get("Retry-After"))
	}
	return bugkit.Result{}, se
}

// String and GoString print the URL and never the key, so a Client printed by
// any verb, or logged, shows no key.
func (c Client) String() string {
	return fmt.Sprintf("intake.Client{URL: %s, Key: <redacted>}", c.URL)
}

func (c Client) GoString() string {
	return fmt.Sprintf("intake.Client{URL: %s, Key: <redacted>}", c.URL)
}

func noRedirect(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}

// form builds the intake's multipart body in memory. Empty optional parts are
// left out; the screenshot is sent as image/png.
func form(who bugkit.Reporter, r bugkit.Report) (body *bytes.Buffer, contentType string, err error) {
	body = new(bytes.Buffer)
	w := multipart.NewWriter(body)

	fields := []struct {
		name, value string
		always      bool
	}{
		{"description", r.Description, true},
		{"impact", r.Impact, true},
		{"area", r.Area, true},
		{"diagnostics", string(r.Diagnostics), true},
		{"version", r.Version, false},
		{"viewport", r.Viewport, false},
		{"user_agent", r.UserAgent, false},
		{"request_id", r.RequestID, false},
		{"reporter_name", who.Name, false},
		{"reporter_email", who.Email, false},
	}
	for _, f := range fields {
		if !f.always && f.value == "" {
			continue
		}
		if err := w.WriteField(f.name, f.value); err != nil {
			return nil, "", fmt.Errorf("bugkit: intake form: %w", err)
		}
	}
	if len(r.Screenshot) > 0 {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="screenshot"; filename="screenshot.png"`)
		h.Set("Content-Type", "image/png")
		part, err := w.CreatePart(h)
		if err != nil {
			return nil, "", fmt.Errorf("bugkit: intake form: %w", err)
		}
		if _, err := part.Write(r.Screenshot); err != nil {
			return nil, "", fmt.Errorf("bugkit: intake form: %w", err)
		}
	}
	if err := w.Close(); err != nil {
		return nil, "", fmt.Errorf("bugkit: intake form: %w", err)
	}
	return body, w.FormDataContentType(), nil
}

// retryAfter reads the intake's Retry-After as whole seconds. Anything else
// (absent, not a number, zero, negative, an HTTP date) is no wait at all.
func retryAfter(h string) time.Duration {
	n, err := strconv.Atoi(strings.TrimSpace(h))
	if err != nil || n <= 0 {
		return 0
	}
	return time.Duration(n) * time.Second
}

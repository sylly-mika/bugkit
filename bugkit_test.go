package bugkit

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestSinkErrorNamesOnlyTheStatus(t *testing.T) {
	if got := (&SinkError{Status: 429, RetryAfter: time.Minute}).Error(); got != "bugkit: intake answered 429" {
		t.Fatalf("Error() = %q", got)
	}
	var se *SinkError
	wrapped := fmt.Errorf("wrap: %w", &SinkError{Status: 503})
	if !errors.As(wrapped, &se) || se.Status != 503 {
		t.Fatalf("errors.As through a wrap: got %v", se)
	}
}

package bugkit

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var t0 = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func TestRateLimiterRefusesPastTheCap(t *testing.T) {
	l := NewRateLimiter(3, time.Hour)
	for i, at := range []time.Time{t0, t0.Add(time.Minute), t0.Add(2 * time.Minute)} {
		if ok, wait := l.Allow("a", at); !ok || wait != 0 {
			t.Fatalf("attempt %d: got (%v, %v), want (true, 0)", i+1, ok, wait)
		}
	}
	ok, wait := l.Allow("a", t0.Add(3*time.Minute))
	if ok || wait != 57*time.Minute {
		t.Fatalf("fourth attempt: got (%v, %v), want (false, 57m0s)", ok, wait)
	}
}

func TestRateLimiterIsPerKey(t *testing.T) {
	l := NewRateLimiter(1, time.Hour)
	if ok, _ := l.Allow("a", t0); !ok {
		t.Fatal(`first "a" refused`)
	}
	if ok, _ := l.Allow("a", t0); ok {
		t.Fatal(`second "a" allowed`)
	}
	if ok, _ := l.Allow("b", t0); !ok {
		t.Fatal(`"b" refused after "a" spent its cap`)
	}
}

func TestRateLimiterPrunesTheWindow(t *testing.T) {
	l := NewRateLimiter(1, time.Hour)
	if ok, _ := l.Allow("a", t0); !ok {
		t.Fatal("first attempt refused")
	}
	if ok, wait := l.Allow("a", t0.Add(time.Hour-time.Nanosecond)); ok || wait != time.Nanosecond {
		t.Fatalf("inside the window: got (%v, %v), want (false, 1ns)", ok, wait)
	}
	if ok, wait := l.Allow("a", t0.Add(time.Hour)); !ok || wait != 0 {
		t.Fatalf("at the window edge: got (%v, %v), want (true, 0)", ok, wait)
	}
}

func TestRateLimiterNilOrZeroCapAllows(t *testing.T) {
	var nilLimiter *RateLimiter
	for name, l := range map[string]*RateLimiter{
		"nil":  nilLimiter,
		"zero": NewRateLimiter(0, time.Hour),
		"neg":  NewRateLimiter(-1, time.Hour),
	} {
		for i := 0; i < 20; i++ {
			if ok, wait := l.Allow("a", t0); !ok || wait != 0 {
				t.Fatalf("%s limiter, call %d: got (%v, %v), want (true, 0)", name, i+1, ok, wait)
			}
		}
	}
}

func TestRateLimiterUnderConcurrentCallers(t *testing.T) {
	l := NewRateLimiter(50, time.Hour)
	var wg sync.WaitGroup
	var allowed atomic.Int64
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, _ := l.Allow("a", t0); ok {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	if n := allowed.Load(); n != 50 {
		t.Fatalf("allowed %d of 100, want 50", n)
	}
}

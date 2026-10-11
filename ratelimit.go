package bugkit

import (
	"sync"
	"time"
)

// RateLimiter caps how many reports one reporter may file in a rolling window.
// Per reporter rather than per IP, because the thing it exists to stop is a
// stuck button or a double-click loop in one browser, not traffic from one
// address.
//
// Pruning bounds each reporter's slice, not the map: keys are never deleted, so
// the map grows by one small entry per distinct reporter. That is the price of
// not running a never-stopped sweeper goroutine.
type RateLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	seen   map[string][]time.Time
}

func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		max:    max,
		window: window,
		seen:   map[string][]time.Time{},
	}
}

// Allow records an attempt for key at now and reports whether it is within the
// cap. When it is not, the duration is how long the caller must wait for the
// oldest attempt to leave the window.
//
// A nil limiter, or one with a non-positive cap, allows everything: the limiter
// is a guard against a runaway client, and an app that has not configured one
// must still be able to file.
func (l *RateLimiter) Allow(key string, now time.Time) (bool, time.Duration) {
	if l == nil || l.max <= 0 {
		return true, 0
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := now.Add(-l.window)
	kept := l.seen[key][:0]
	for _, at := range l.seen[key] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}

	if len(kept) >= l.max {
		l.seen[key] = kept
		return false, kept[0].Add(l.window).Sub(now)
	}

	l.seen[key] = append(kept, now)
	return true, 0
}

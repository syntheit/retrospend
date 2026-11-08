package config

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakeAfter fires at once and records the delays asked for, so no test waits.
type fakeAfter struct{ delays []time.Duration }

func (f *fakeAfter) after(d time.Duration) <-chan time.Time {
	f.delays = append(f.delays, d)
	ch := make(chan time.Time, 1)
	ch <- time.Time{}
	return ch
}

func watchOptions(f *fakeAfter, logs *[]string) WatchOptions {
	return WatchOptions{
		Interval: 30 * time.Second,
		After:    f.after,
		Logf:     func(format string, args ...any) { *logs = append(*logs, format) },
	}
}

func TestWatchReturnsWhenTheOwnerRoleAppears(t *testing.T) {
	answers := []bool{false, false, true}
	calls := 0
	exists := func(context.Context) (bool, error) {
		a := answers[calls]
		calls++
		return a, nil
	}
	f := &fakeAfter{}
	var logs []string
	if err := WatchForOwnerRole(context.Background(), exists, watchOptions(f, &logs)); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("checked %d times, want 3", calls)
	}
	for _, d := range f.delays {
		if d != 30*time.Second {
			t.Fatalf("polled after %s, want 30s", d)
		}
	}
	if len(f.delays) != 3 || !strings.Contains(strings.Join(logs, "\n"), "now exists") {
		t.Fatalf("delays %v, logs %v", f.delays, logs)
	}
}

// A failed check says nothing about the role: it is retried, and neither read
// as "found" (a needless restart) nor as "missing".
func TestWatchRetriesAFailedCheck(t *testing.T) {
	results := []struct {
		found bool
		err   error
	}{{false, errors.New("connection reset")}, {false, errors.New("timeout")}, {true, nil}}
	calls := 0
	exists := func(context.Context) (bool, error) {
		r := results[calls]
		calls++
		return r.found, r.err
	}
	f := &fakeAfter{}
	var logs []string
	if err := WatchForOwnerRole(context.Background(), exists, watchOptions(f, &logs)); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("checked %d times, want 3", calls)
	}
	failures := 0
	for _, l := range logs {
		if strings.Contains(l, "check failed") {
			failures++
		}
	}
	if failures != 2 {
		t.Fatalf("logged %d failures, want 2: %v", failures, logs)
	}
}

func TestWatchStopsWhenTheContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	exists := func(context.Context) (bool, error) {
		calls++
		cancel() // the sidecar is shutting down for another reason
		return false, nil
	}
	f := &fakeAfter{}
	var logs []string
	err := WatchForOwnerRole(ctx, exists, watchOptions(f, &logs))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
	if calls != 1 {
		t.Fatalf("checked %d times after the context ended", calls)
	}
}

// The default is the 30 seconds the watchdog was specified with.
func TestDefaultWatchInterval(t *testing.T) {
	if DefaultWatchOptions().Interval != 30*time.Second {
		t.Fatalf("interval %s", DefaultWatchOptions().Interval)
	}
}

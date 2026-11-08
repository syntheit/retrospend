package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"retrospend-sidecar/config"
	"retrospend-sidecar/tasks"

	"github.com/jackc/pgx/v5"
	"github.com/robfig/cron/v3"
)

// recorder collects what lifecycle did, in order.
type recorder struct {
	mu     sync.Mutex
	events []string
	logs   []string
}

func (r *recorder) add(e string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func (r *recorder) log(format string, _ ...any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logs = append(r.logs, format)
}

func (r *recorder) list() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.events...)
}

func (r *recorder) logText() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.logs, "\n")
}

// fakeLifecycle is a lifecycle with every effect replaced.
type fakeLifecycle struct {
	*lifecycle
	rec       *recorder
	signals   chan os.Signal
	ownerAsks atomic.Int32
	// cronDone is what stopScheduler hands back; tests close it when "the
	// running jobs" are done.
	cronDone chan struct{}
	jobs     *sync.WaitGroup
}

func newFakeLifecycle(super bool, ownerAfter int32) *fakeLifecycle {
	f := &fakeLifecycle{
		rec:      &recorder{},
		signals:  make(chan os.Signal, 1),
		cronDone: make(chan struct{}),
		jobs:     &sync.WaitGroup{},
	}
	f.lifecycle = &lifecycle{
		isSuperuser: func(context.Context) (bool, error) { return super, nil },
		ownerExists: func(context.Context) (bool, error) {
			n := f.ownerAsks.Add(1)
			return ownerAfter > 0 && n >= ownerAfter, nil
		},
		watch: config.WatchOptions{
			Interval: time.Millisecond,
			After:    func(time.Duration) <-chan time.Time { return time.After(time.Millisecond) },
		},
		detectTries: 3,
		sleep:       func(time.Duration) {},
		stopScheduler: func() <-chan struct{} {
			f.rec.add("stopScheduler")
			return f.cronDone
		},
		stopHTTP: func(context.Context) error { f.rec.add("stopHTTP"); return nil },
		httpJobs: f.jobs,
		stopBackups: func() bool {
			f.rec.add("stopBackups")
			return true
		},
		closeDB:     func() { f.rec.add("closeDB") },
		signals:     f.signals,
		signalDrain: time.Second,
		ownerDrain:  5 * time.Second,
		logf:        f.rec.log,
	}
	return f
}

func TestLifecycleOwnerAppearsAbortsTheBackupDrainsAndExitsNonZero(t *testing.T) {
	f := newFakeLifecycle(true, 3)
	if err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	// A scheduled job and a requested one are still running when the role
	// appears; the pool must not close under them.
	var jobsFinished atomic.Bool
	f.jobs.Add(1)
	go func() {
		defer f.jobs.Done()
		for f.ownerAsks.Load() < 3 {
			time.Sleep(time.Millisecond)
		}
		time.Sleep(100 * time.Millisecond)
	}()
	go func() {
		for f.ownerAsks.Load() < 3 {
			time.Sleep(time.Millisecond)
		}
		time.Sleep(60 * time.Millisecond)
		jobsFinished.Store(true)
		close(f.cronDone)
	}()

	code := f.run()
	if code != 1 {
		t.Fatalf("exit code %d, want 1 so the restart policy restarts it", code)
	}
	events := f.rec.list()
	want := []string{"stopScheduler", "stopBackups", "stopHTTP", "closeDB"}
	if strings.Join(events, ",") != strings.Join(want, ",") {
		t.Fatalf("events %v, want %v", events, want)
	}
	if !jobsFinished.Load() {
		t.Fatal("the database closed before the running jobs finished")
	}
	if f.ownerAsks.Load() < 3 {
		t.Fatalf("the watchdog asked %d times", f.ownerAsks.Load())
	}
	if !strings.Contains(f.rec.logText(), "role exists") {
		t.Fatalf("the reason was not logged:\n%s", f.rec.logText())
	}
}

func TestLifecycleOnANonSuperuserSessionNeverWatches(t *testing.T) {
	f := newFakeLifecycle(false, 1)
	if err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	close(f.cronDone)
	f.signals <- os.Interrupt
	if code := f.run(); code != 0 {
		t.Fatalf("exit code %d after a signal", code)
	}
	time.Sleep(20 * time.Millisecond)
	if f.ownerAsks.Load() != 0 {
		t.Fatal("the owner role watchdog ran on a session that is not a superuser's")
	}
	if got := strings.Join(f.rec.list(), ","); got != "stopScheduler,stopHTTP,closeDB" {
		t.Fatalf("events %s: a signal must not abort a backup", got)
	}
}

func TestLifecycleSignalStopsTheWatchdog(t *testing.T) {
	f := newFakeLifecycle(true, 0) // the role never appears
	if err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	close(f.cronDone)
	for f.ownerAsks.Load() < 2 {
		time.Sleep(time.Millisecond)
	}
	f.signals <- os.Interrupt
	if code := f.run(); code != 0 {
		t.Fatalf("exit code %d", code)
	}
	after := f.ownerAsks.Load()
	time.Sleep(30 * time.Millisecond)
	if f.ownerAsks.Load() > after+1 {
		t.Fatal("the watchdog kept polling after shutdown")
	}
	for _, e := range f.rec.list() {
		if e == "stopBackups" {
			t.Fatal("a signal aborted a backup")
		}
	}
}

func TestLifecycleDrainIsBoundedThenClosesAnyway(t *testing.T) {
	f := newFakeLifecycle(true, 1)
	f.ownerDrain = 50 * time.Millisecond
	if err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	// cronDone never closes: a job that will not finish.
	begin := time.Now()
	if code := f.run(); code != 1 {
		t.Fatalf("exit code %d", code)
	}
	if time.Since(begin) > 3*time.Second {
		t.Fatal("did not give up waiting for the job")
	}
	if got := f.rec.list(); got[len(got)-1] != "closeDB" {
		t.Fatalf("events %v", got)
	}
	if !strings.Contains(f.rec.logText(), "did not finish in time") {
		t.Fatalf("no log of the timeout:\n%s", f.rec.logText())
	}
}

// A session that cannot be checked is never run unchecked: retry a bounded
// number of times, then refuse to start so the restart retries.
func TestLifecycleStartRefusesAnUncheckedSession(t *testing.T) {
	f := newFakeLifecycle(true, 1)
	calls := 0
	sleeps := 0
	f.isSuperuser = func(context.Context) (bool, error) {
		calls++
		return false, errors.New("connection reset")
	}
	f.sleep = func(time.Duration) { sleeps++ }
	err := f.start(context.Background())
	if err == nil {
		t.Fatal("start succeeded on a session it could not check")
	}
	if calls != 3 || sleeps != 2 {
		t.Fatalf("%d checks and %d waits, want 3 and 2", calls, sleeps)
	}
	if f.ownerAsks.Load() != 0 {
		t.Fatal("the watchdog started anyway")
	}
}

func TestLifecycleStartRecoversFromATransientFailure(t *testing.T) {
	f := newFakeLifecycle(true, 0)
	calls := 0
	f.isSuperuser = func(context.Context) (bool, error) {
		calls++
		if calls < 3 {
			return false, errors.New("connection reset")
		}
		return true, nil
	}
	if err := f.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	// It found a superuser session, so the watchdog runs.
	close(f.cronDone)
	f.signals <- os.Interrupt
	f.run()
	if calls != 3 {
		t.Fatalf("%d checks", calls)
	}
}

// fakeQuerier answers the two catalog questions the way a database would.
type fakeQuerier struct {
	super      bool
	roleAfter  int32
	roleChecks atomic.Int32
}

type fakeRow struct{ value bool }

func (r fakeRow) Scan(dest ...any) error {
	*(dest[0].(*bool)) = r.value
	return nil
}

func (q *fakeQuerier) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	if len(args) == 1 {
		n := q.roleChecks.Add(1)
		return fakeRow{value: q.roleAfter > 0 && n >= q.roleAfter}
	}
	return fakeRow{value: q.super}
}

// newLifecycle is the only place the real scheduler, server, backup tasks and
// pool are tied to the supervisor. Take any of those wires out and this fails.
func TestNewLifecycleWiresTheRealParts(t *testing.T) {
	q := &fakeQuerier{super: true, roleAfter: 2}

	var runs atomic.Int32
	c := cron.New()
	if _, err := c.AddFunc("@every 1s", func() { runs.Add(1) }); err != nil {
		t.Fatal(err)
	}
	c.Start()
	t.Cleanup(func() { c.Stop() })

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.NewServeMux()}
	go server.Serve(listener)

	var jobs sync.WaitGroup
	var closed atomic.Bool
	signals := make(chan os.Signal, 1)
	lc := newLifecycle(q, c, server, &jobs, func() { closed.Store(true) }, signals)
	lc.watch.Interval = 10 * time.Millisecond
	lc.logf = func(string, ...any) {}

	// A background job that a request started: shutdown waits for it.
	var jobDone atomic.Bool
	jobs.Add(1)
	go func() {
		defer jobs.Done()
		time.Sleep(150 * time.Millisecond)
		jobDone.Store(true)
	}()

	if err := lc.start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if code := lc.run(); code != 1 {
		t.Fatalf("exit code %d, want 1", code)
	}

	if q.roleChecks.Load() < 2 {
		t.Fatalf("the watchdog asked the pool %d times", q.roleChecks.Load())
	}
	if !closed.Load() {
		t.Fatal("the pool was not closed")
	}
	if !jobDone.Load() {
		t.Fatal("shutdown did not wait for the background job")
	}
	if conn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second); err == nil {
		conn.Close()
		t.Fatal("the HTTP server still accepts connections")
	}
	// The scheduler is stopped: its job does not fire again.
	atReturn := runs.Load()
	time.Sleep(2300 * time.Millisecond)
	if runs.Load() != atReturn {
		t.Fatalf("the scheduled job ran %d more times after shutdown", runs.Load()-atReturn)
	}
	// And backups are refused from now on (the tasks package's own state).
	err = backupAfterStop(t)
	if err == nil || !strings.Contains(err.Error(), "stopped") {
		t.Fatalf("a backup after the owner role appeared returned %v", err)
	}
}

// backupAfterStop starts a backup the way the schedule would. After
// tasks.StopBackups it returns at once with a "stopped" error, before it looks
// at the URL or runs pg_dump.
func backupAfterStop(t *testing.T) error {
	t.Helper()
	return tasks.RunBackup(nil, "postgresql://u:p@127.0.0.1:1/none", t.TempDir(), 1, nil)
}

package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"retrospend-sidecar/config"
	"retrospend-sidecar/tasks"

	"github.com/robfig/cron/v3"
)

// lifecycle runs the sidecar from "jobs may start" to "stopped": it waits for
// a signal and shuts down in order. When entrypoint.sh fell back to the
// superuser URL (the owner role did not exist), it also watches for the role;
// once it exists, a superuser session writing to tables the owner owns could
// fire a trigger the owner planted, so the sidecar stops taking work, aborts a
// running pg_dump (its locks stall the app's ownership handover), lets other
// running jobs finish within a bound, and exits non-zero. The restart goes
// through the wrapper, which then resolves to the owner's URL.
//
// Every effect is a field, so lifecycle_test.go runs the sequence against
// fakes. newLifecycle wires the real ones.
type lifecycle struct {
	// isSuperuser tells whether this session is a superuser (fallback mode).
	isSuperuser func(context.Context) (bool, error)
	// ownerExists asks pg_roles whether the owner role exists.
	ownerExists func(context.Context) (bool, error)
	watch       config.WatchOptions

	// A failed isSuperuser is retried this many times, then start fails: the
	// sidecar never runs on a session it could not check.
	detectTries int
	detectEvery time.Duration
	sleep       func(time.Duration)

	// stopScheduler stops scheduled jobs from starting; the channel closes when
	// the ones running have finished.
	stopScheduler func() <-chan struct{}
	// stopHTTP stops accepting requests and waits for the ones in flight.
	stopHTTP func(context.Context) error
	// httpJobs counts background jobs that requests started.
	httpJobs *sync.WaitGroup
	// stopBackups aborts a running pg_dump and refuses later ones.
	stopBackups func() bool
	closeDB     func()

	signals <-chan os.Signal
	// How long running jobs may take to finish after a signal, and after the
	// owner role appeared.
	signalDrain time.Duration
	ownerDrain  time.Duration
	logf        func(format string, args ...any)

	ownerAppeared chan struct{}
	watchCancel   context.CancelFunc
}

// newLifecycle wires the real effects: the pool for the two catalog
// questions, the cron scheduler, the HTTP server and the backup tasks.
func newLifecycle(q config.RowQuerier, c *cron.Cron, server *http.Server, httpJobs *sync.WaitGroup, closeDB func(), signals <-chan os.Signal) *lifecycle {
	return &lifecycle{
		isSuperuser: func(ctx context.Context) (bool, error) { return config.RunningAsSuperuser(ctx, q) },
		ownerExists: func(ctx context.Context) (bool, error) { return config.OwnerRoleExists(ctx, q) },
		watch:       config.DefaultWatchOptions(),
		detectTries: 6,
		detectEvery: 5 * time.Second,
		sleep:       time.Sleep,
		stopScheduler: func() <-chan struct{} {
			return c.Stop().Done()
		},
		stopHTTP:    server.Shutdown,
		httpJobs:    httpJobs,
		stopBackups: tasks.StopBackups,
		closeDB:     closeDB,
		signals:     signals,
		signalDrain: 30 * time.Second,
		ownerDrain:  5 * time.Minute,
		logf:        log.Printf,
	}
}

// start finds out whether the sidecar runs as a superuser and, if so, starts
// the watchdog. Call it before any job can start. An error means the session
// could not be checked: the caller must exit (the restart retries) and not run.
func (l *lifecycle) start(ctx context.Context) error {
	l.ownerAppeared = make(chan struct{})
	var super bool
	var err error
	for attempt := 1; ; attempt++ {
		super, err = l.isSuperuser(ctx)
		if err == nil {
			break
		}
		if attempt >= l.detectTries {
			return fmt.Errorf("cannot tell whether this database session is a superuser's: %w", err)
		}
		l.logf("could not tell whether this session is a superuser (attempt %d of %d): %v", attempt, l.detectTries, err)
		l.sleep(l.detectEvery)
	}
	if !super {
		return nil
	}
	l.logf("WARNING: running as a superuser because the %s role did not exist at start. Watching for it; the sidecar restarts when it appears.", config.OwnerRole)
	watchCtx, cancel := context.WithCancel(ctx)
	l.watchCancel = cancel
	opts := l.watch
	opts.Logf = l.logf
	go func() {
		if config.WatchForOwnerRole(watchCtx, l.ownerExists, opts) == nil {
			close(l.ownerAppeared)
		}
	}()
	return nil
}

// run blocks until a signal arrives or the owner role appears, shuts down in
// order, and returns the process's exit code: 0 after a signal, 1 when it
// stops because the owner role appeared.
func (l *lifecycle) run() int {
	code := 0
	drain := l.signalDrain
	select {
	case <-l.signals:
		l.logf("Shutting down gracefully...")
	case <-l.ownerAppeared:
		l.logf("The %s role exists: no new jobs, aborting a running backup, finishing the other running jobs, then exiting so the restart connects as the owner", config.OwnerRole)
		code = 1
		drain = l.ownerDrain
	}
	if l.watchCancel != nil {
		l.watchCancel()
	}

	// No new scheduled jobs; the channel closes when running ones finish.
	cronDone := l.stopScheduler()
	if code != 0 {
		if l.stopBackups() {
			l.logf("Aborted a running backup; the next scheduled run backs up as the owner")
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), drain)
	defer cancel()
	if err := l.stopHTTP(ctx); err != nil {
		l.logf("HTTP server shutdown error: %v", err)
	} else {
		l.logf("HTTP server stopped gracefully")
	}

	// Let scheduled jobs and requested ones finish before the pool closes
	// under them.
	jobsDone := make(chan struct{})
	go func() {
		<-cronDone
		l.httpJobs.Wait()
		close(jobsDone)
	}()
	select {
	case <-jobsDone:
		l.logf("Running jobs finished")
	case <-ctx.Done():
		l.logf("Running jobs did not finish in time: closing anyway")
	}

	l.closeDB()
	l.logf("Sidecar stopped")
	return code
}

package config

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// RowQuerier is what a pgx pool or connection offers for one-row queries.
type RowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// RunningAsSuperuser reports whether the session behind q is a superuser. The
// sidecar runs this once after it connects: a superuser session means the
// wrapper fell back to the URL as given because the owner role did not exist,
// and WatchForOwnerRole must run. It reads pg_catalog only.
func RunningAsSuperuser(ctx context.Context, q RowQuerier) (bool, error) {
	var super bool
	err := q.QueryRow(ctx, isSuperuserSQL).Scan(&super)
	return super, err
}

// OwnerRoleExists reports whether the owner role exists, from pg_roles alone.
// A superuser session must never read an app table, so this is the only
// question the watchdog asks.
func OwnerRoleExists(ctx context.Context, q RowQuerier) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, roleExistsSQL, OwnerRole).Scan(&exists)
	return exists, err
}

// WatchOptions tunes WatchForOwnerRole.
type WatchOptions struct {
	Interval time.Duration
	Logf     func(format string, args ...any)
	// After returns a channel that fires after d. Tests replace it.
	After func(d time.Duration) <-chan time.Time
}

// DefaultWatchOptions checks every 30 seconds.
func DefaultWatchOptions() WatchOptions {
	return WatchOptions{Interval: 30 * time.Second, Logf: func(string, ...any) {}}
}

// WatchForOwnerRole is the sidecar's watchdog for fallback mode. While the
// sidecar runs as the superuser (the owner role did not exist at start), its
// writes to tables the owner may later own could fire a trigger the owner
// planted, as the superuser. So as soon as the role exists this returns nil
// and the caller stops taking work and exits non-zero; the restart goes
// through the wrapper, which then resolves to the owner's URL. It returns
// ctx.Err() when ctx ends first. A failed check is logged and retried, never
// read as "the role does not exist" or as "it does".
func WatchForOwnerRole(ctx context.Context, exists func(context.Context) (bool, error), o WatchOptions) error {
	if o.Logf == nil {
		o.Logf = func(string, ...any) {}
	}
	if o.After == nil {
		o.After = time.After
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-o.After(o.Interval):
		}
		// Both may be ready at once; the context wins.
		if ctx.Err() != nil {
			return ctx.Err()
		}
		found, err := exists(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			o.Logf("owner role check failed, will retry: %v", err)
			continue
		}
		if found {
			o.Logf("the %s role now exists while the sidecar runs as the superuser", OwnerRole)
			return nil
		}
	}
}

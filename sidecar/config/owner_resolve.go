package config

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// OwnerOptions tunes ResolveOwnerURL. Start from DefaultOwnerOptions.
type OwnerOptions struct {
	// OwnerPassword is DATABASE_OWNER_PASSWORD: a secret of the operator's own
	// in place of the derived one. Empty means derive.
	OwnerPassword string
	// RoleWait is how long to wait for the owner role to appear. After it, a
	// database that still has no owner role is an old app image that never
	// bootstraps, and the URL as given is used.
	RoleWait time.Duration
	// ReadyWait is how long, once the role exists, to wait for it to sign in
	// and for the ownership handover to finish. After it ResolveOwnerURL fails
	// and never falls back: the superuser is not a stand-in for a slow start.
	ReadyWait time.Duration
	Poll      time.Duration
	Logf      func(format string, args ...any)

	// Test seams.
	Probe ownerProbe
	Sleep func(time.Duration)
	Now   func() time.Time
}

// DefaultOwnerOptions: the app's entrypoint normally finishes in seconds; the
// waits cover a first upgrade where the sidecar starts before the app.
func DefaultOwnerOptions() OwnerOptions {
	return OwnerOptions{
		RoleWait:  2 * time.Minute,
		ReadyWait: 5 * time.Minute,
		Poll:      5 * time.Second,
		Logf:      func(string, ...any) {},
	}
}

// ownerProbe is what ResolveOwnerURL needs to ask the database.
type ownerProbe interface {
	// IsSuperuser: the URL's own role is a superuser.
	IsSuperuser(ctx context.Context, databaseURL string) (bool, error)
	// RoleExists: the owner role exists (any session can read pg_roles).
	RoleExists(ctx context.Context, databaseURL string) (bool, error)
	// OwnerState signs in with ownerURL and reports how far along it is.
	OwnerState(ctx context.Context, ownerURL string) (OwnerState, error)
}

// OwnerState is what a session of the owner role sees.
type OwnerState struct {
	Superuser bool
	// Pending counts objects in public and keystore that another role still
	// owns. Zero means the handover is done.
	Pending int
}

// ErrOwnerUnusable is returned when the owner role exists but this container
// cannot work out its URL (no password it can read, and no
// DATABASE_OWNER_PASSWORD). The superuser URL is not a fallback then.
var ErrOwnerUnusable = errors.New("the owner role cannot be used")

// ErrOwnerNotReady is returned when the owner role exists but did not sign in
// or finish the handover in time.
var ErrOwnerNotReady = errors.New("the owner role is not ready")

// ResolveOwnerURL decides which URL the sidecar connects with.
//
//   - A URL that is not a superuser's (managed Postgres, a setup done by hand)
//     is used as given.
//   - Otherwise it waits for the owner role, derives its URL, waits until the
//     role signs in and nothing is left to hand over, and returns that URL.
//   - The URL as given, with a loud warning, is returned only when the owner
//     role does not exist: after RoleWait (an old app image that never
//     bootstraps), or at once when the superuser URL has no password this
//     container can read (nothing to derive from, and the app refuses too).
//   - While the role exists there is never a fallback. A role that exists but
//     is not ready after ReadyWait is ErrOwnerNotReady; one whose password
//     this container cannot work out is ErrOwnerUnusable.
//
// It never logs a URL or a password.
func ResolveOwnerURL(ctx context.Context, databaseURL string, o OwnerOptions) (string, error) {
	if o.Probe == nil {
		o.Probe = pgProbe{}
	}
	if o.Sleep == nil {
		o.Sleep = time.Sleep
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Logf == nil {
		o.Logf = func(string, ...any) {}
	}

	roleDeadline := o.Now().Add(o.RoleWait)

	// Is this a superuser URL? The database may still be starting.
	var superuser bool
	for {
		var err error
		superuser, err = o.Probe.IsSuperuser(ctx, databaseURL)
		if err == nil {
			break
		}
		if !o.Now().Before(roleDeadline) {
			return "", fmt.Errorf("cannot reach the database: %w", err)
		}
		o.Logf("database not reachable yet: %v", err)
		o.Sleep(o.Poll)
	}
	if !superuser {
		o.Logf("DATABASE_URL is not a superuser's: using it as given")
		return databaseURL, nil
	}

	// Work out the owner's URL. When that is not possible, the owner role may
	// still exist (the app created it with a password this container cannot
	// derive): then there is no fallback, because a superuser session writing
	// to tables the owner owns can fire triggers the owner planted.
	ownerURL, unusable := ownerURLFor(databaseURL, o.OwnerPassword)
	if unusable != "" {
		exists, err := o.askRole(ctx, databaseURL, roleDeadline)
		if err != nil {
			return "", err
		}
		if exists {
			return "", fmt.Errorf("%w: the %s role exists, but this container cannot use it: %s", ErrOwnerUnusable, OwnerRole, unusable)
		}
		o.Logf("WARNING: %s, so the sidecar keeps connecting as the superuser because the %s role does not exist. If the app creates it later, the sidecar stops and then refuses to start until this is fixed.", unusable, OwnerRole)
		return databaseURL, nil
	}

	// Wait for the role to exist. The app's entrypoint creates it; on a first
	// upgrade the sidecar can start first.
	logged := false
	for {
		exists, err := o.askRole(ctx, databaseURL, roleDeadline)
		if err != nil {
			return "", err
		}
		if exists {
			break
		}
		if !o.Now().Before(roleDeadline) {
			o.Logf("WARNING: the %s role does not exist after %s. This looks like an app image that does not create it, so the sidecar connects as the superuser from DATABASE_URL. Update the app image to run the sidecar without it.", OwnerRole, o.RoleWait)
			return databaseURL, nil
		}
		if !logged {
			o.Logf("waiting up to %s for the app to create the %s role", o.RoleWait, OwnerRole)
			logged = true
		}
		o.Sleep(o.Poll)
	}

	// The role exists: from here on there is no fallback.
	readyDeadline := o.Now().Add(o.ReadyWait)
	for {
		state, err := o.Probe.OwnerState(ctx, ownerURL)
		var last string
		switch {
		case err != nil:
			last = fmt.Sprintf("the owner cannot sign in yet: %v", err)
		case state.Superuser:
			last = "the owner role is a superuser"
		case state.Pending > 0:
			last = fmt.Sprintf("%d objects are not handed to the owner yet", state.Pending)
		default:
			o.Logf("connecting as %s", OwnerRole)
			return ownerURL, nil
		}
		if !o.Now().Before(readyDeadline) {
			return "", fmt.Errorf("%w after %s: %s", ErrOwnerNotReady, o.ReadyWait, last)
		}
		o.Logf("waiting for the owner role: %s", last)
		o.Sleep(o.Poll)
	}
}

// pgProbe asks the database. A superuser session must never read or write an
// app table: the owner role owns them and can attach triggers or functions
// that would run with the superuser's rights. So the superuser connection
// asks only about pg_roles, and the handover check runs as the owner, over
// pg_catalog alone (TestOwnerQueriesTouchOnlyCatalogs checks the text).
// ownerURLFor returns the owner's URL, or why it cannot be built. The reason
// names a likely cause and never holds a password or a URL.
func ownerURLFor(databaseURL, override string) (ownerURL, unusable string) {
	password := override
	if password == "" {
		superPassword, ok := URLPassword(databaseURL)
		if !ok {
			return "", "DATABASE_URL has no password the sidecar can read (give the database user a password, percent-encode spaces, or set DATABASE_OWNER_PASSWORD to the value the app container has)"
		}
		password = DeriveOwnerPassword(superPassword)
	}
	built, err := OwnerURL(databaseURL, password)
	if err != nil {
		return "", fmt.Sprintf("the owner URL cannot be built from DATABASE_URL (%v)", err)
	}
	return built, ""
}

// askRole asks whether the owner role exists, retrying a failed question until
// deadline: a failed check is never read as "missing".
func (o OwnerOptions) askRole(ctx context.Context, databaseURL string, deadline time.Time) (bool, error) {
	for {
		exists, err := o.Probe.RoleExists(ctx, databaseURL)
		if err == nil {
			return exists, nil
		}
		if !o.Now().Before(deadline) {
			return false, fmt.Errorf("cannot check for the %s role: %w", OwnerRole, err)
		}
		o.Logf("cannot check for the %s role yet: %v", OwnerRole, err)
		o.Sleep(o.Poll)
	}
}

type pgProbe struct{}

const (
	isSuperuserSQL = `SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user`
	roleExistsSQL  = `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1)`
)

const probeTimeout = 10 * time.Second

// connectOnce opens one connection with a deadline. The returned func closes
// it.
func connectOnce(ctx context.Context, databaseURL string) (*pgx.Conn, func(), error) {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	return conn, func() {
		_ = conn.Close(context.Background())
		cancel()
	}, nil
}

func (pgProbe) IsSuperuser(ctx context.Context, databaseURL string) (bool, error) {
	conn, done, err := connectOnce(ctx, databaseURL)
	if err != nil {
		return false, err
	}
	defer done()
	var super bool
	err = conn.QueryRow(ctx, isSuperuserSQL).Scan(&super)
	return super, err
}

func (pgProbe) RoleExists(ctx context.Context, databaseURL string) (bool, error) {
	conn, done, err := connectOnce(ctx, databaseURL)
	if err != nil {
		return false, err
	}
	defer done()
	var exists bool
	err = conn.QueryRow(ctx, roleExistsSQL, OwnerRole).Scan(&exists)
	return exists, err
}

// pendingHandoverSQL mirrors prisma/bootstrap/owner-handover.sql: the same
// object kinds, in public and keystore, with extension members left out. The
// sidecar only reads this; the handover itself is the app entrypoint's job.
const pendingHandoverSQL = `
WITH owner AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1),
schemas AS (
  SELECT oid, nspowner FROM pg_catalog.pg_namespace WHERE nspname IN ('public', 'keystore')
)
SELECT (
  (SELECT count(*) FROM schemas s, owner o WHERE s.nspowner <> o.oid)
  + (SELECT count(*) FROM pg_catalog.pg_class c
       JOIN schemas s ON s.oid = c.relnamespace, owner o
      WHERE c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f', 'c')
        AND c.relowner <> o.oid
        AND NOT (c.relkind = 'S' AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
               WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                 AND d.objid = c.oid AND d.deptype IN ('a', 'i')))
        AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
               WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
                 AND d.objid = c.oid AND d.deptype = 'e'))
  + (SELECT count(*) FROM pg_catalog.pg_type t
       JOIN schemas s ON s.oid = t.typnamespace, owner o
      WHERE t.typtype IN ('e', 'd', 'r')
        AND t.typowner <> o.oid
        AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
               WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
                 AND d.objid = t.oid AND d.deptype = 'e'))
  + (SELECT count(*) FROM pg_catalog.pg_proc p
       JOIN schemas s ON s.oid = p.pronamespace, owner o
      WHERE p.proowner <> o.oid
        AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend d
               WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                 AND d.objid = p.oid AND d.deptype = 'e'))
)::int`

func (pgProbe) OwnerState(ctx context.Context, ownerURL string) (OwnerState, error) {
	conn, done, err := connectOnce(ctx, ownerURL)
	if err != nil {
		return OwnerState{}, err
	}
	defer done()
	var state OwnerState
	if err := conn.QueryRow(ctx, isSuperuserSQL).Scan(&state.Superuser); err != nil {
		return OwnerState{}, err
	}
	if err := conn.QueryRow(ctx, pendingHandoverSQL, OwnerRole).Scan(&state.Pending); err != nil {
		return OwnerState{}, err
	}
	return state, nil
}

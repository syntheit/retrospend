package config

import (
	"context"
	"errors"
	"fmt"
	"time"
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
	o = o.withDefaults()
	roleDeadline := o.Now().Add(o.RoleWait)

	// Is this a superuser URL? The database may still be starting.
	facts, err := o.awaitDatabase(ctx, databaseURL, roleDeadline)
	if err != nil {
		return "", err
	}
	if !facts.Superuser {
		o.Logf("DATABASE_URL is not a superuser's: using it as given")
		return databaseURL, nil
	}

	// Work out the owner's URL. When that is not possible, the owner role may
	// still exist (the app created it with a password this container cannot
	// derive): then there is no fallback, because a superuser session writing
	// to tables the owner owns can fire triggers the owner planted.
	ownerURL, unusable := ownerURLFor(databaseURL, o.OwnerPassword)
	if unusable != "" {
		return o.resolveUnusable(ctx, databaseURL, facts, roleDeadline, unusable)
	}

	exists, err := o.awaitRole(ctx, databaseURL, facts, roleDeadline)
	if err != nil {
		return "", err
	}
	if !exists {
		return databaseURL, nil
	}
	return o.awaitReady(ctx, ownerURL)
}

func (o OwnerOptions) withDefaults() OwnerOptions {
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
	return o
}

// awaitDatabase asks until the database answers: the URL's own role and, for a
// superuser, whether the owner role exists, on one connection per attempt.
func (o OwnerOptions) awaitDatabase(ctx context.Context, databaseURL string, deadline time.Time) (Facts, error) {
	for {
		facts, err := o.Probe.Facts(ctx, databaseURL)
		if err == nil {
			return facts, nil
		}
		if !o.Now().Before(deadline) {
			return Facts{}, fmt.Errorf("cannot reach the database: %w", err)
		}
		o.Logf("database not reachable yet: %v", err)
		o.Sleep(o.Poll)
	}
}

// resolveUnusable decides what to do when the owner's URL cannot be built: the
// role exists (exit) or it does not (keep the URL as given, with a warning).
func (o OwnerOptions) resolveUnusable(ctx context.Context, databaseURL string, facts Facts, deadline time.Time, unusable string) (string, error) {
	exists, err := o.askRole(ctx, databaseURL, facts, deadline)
	if err != nil {
		return "", err
	}
	if exists {
		return "", fmt.Errorf("%w: the %s role exists, but this container cannot use it: %s", ErrOwnerUnusable, OwnerRole, unusable)
	}
	o.Logf("WARNING: %s, so the sidecar keeps connecting as the superuser because the %s role does not exist. If the app creates it later, the sidecar stops and then refuses to start until this is fixed.", unusable, OwnerRole)
	return databaseURL, nil
}

// awaitRole waits for the owner role to exist. The app's entrypoint creates it;
// on a first upgrade the sidecar can start first. exists is false only when
// the role still does not exist after RoleWait (an old app image), which it
// logs loudly.
func (o OwnerOptions) awaitRole(ctx context.Context, databaseURL string, facts Facts, deadline time.Time) (bool, error) {
	logged := false
	for {
		exists, err := o.askRole(ctx, databaseURL, facts, deadline)
		if err != nil {
			return false, err
		}
		if exists {
			return true, nil
		}
		if !o.Now().Before(deadline) {
			o.Logf("WARNING: the %s role does not exist after %s. This looks like an app image that does not create it, so the sidecar connects as the superuser from DATABASE_URL. Update the app image to run the sidecar without it.", OwnerRole, o.RoleWait)
			return false, nil
		}
		if !logged {
			o.Logf("waiting up to %s for the app to create the %s role", o.RoleWait, OwnerRole)
			logged = true
		}
		o.Sleep(o.Poll)
		facts = o.refresh(ctx, databaseURL)
	}
}

// askRole reads the role question out of facts, retrying a failed one until
// deadline: a failed check is never read as "missing".
func (o OwnerOptions) askRole(ctx context.Context, databaseURL string, facts Facts, deadline time.Time) (bool, error) {
	for {
		if facts.RoleErr == nil {
			return facts.RoleExists, nil
		}
		if !o.Now().Before(deadline) {
			return false, fmt.Errorf("cannot check for the %s role: %w", OwnerRole, facts.RoleErr)
		}
		o.Logf("cannot check for the %s role yet: %v", OwnerRole, facts.RoleErr)
		o.Sleep(o.Poll)
		facts = o.refresh(ctx, databaseURL)
	}
}

// refresh asks again. A connection that fails now is a failed role check.
func (o OwnerOptions) refresh(ctx context.Context, databaseURL string) Facts {
	facts, err := o.Probe.Facts(ctx, databaseURL)
	if err != nil {
		return Facts{RoleErr: err}
	}
	return facts
}

// awaitReady waits until the owner signs in, is no superuser and nothing is
// left to hand over. The role exists: from here on there is no fallback.
func (o OwnerOptions) awaitReady(ctx context.Context, ownerURL string) (string, error) {
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

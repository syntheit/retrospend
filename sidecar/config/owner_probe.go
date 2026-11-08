package config

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// ownerProbe is what ResolveOwnerURL needs to ask the database.
type ownerProbe interface {
	// Facts opens one connection with databaseURL and asks it both questions.
	// An error means the connection or the superuser question failed; a failed
	// role question is Facts.RoleErr.
	Facts(ctx context.Context, databaseURL string) (Facts, error)
	// OwnerState signs in with ownerURL (a different login, so a connection of
	// its own) and reports how far along the owner is.
	OwnerState(ctx context.Context, ownerURL string) (OwnerState, error)
}

// Facts is what a session of the URL's own role sees.
type Facts struct {
	// Superuser: the URL's own role is a superuser.
	Superuser bool
	// RoleExists: the owner role exists. Only asked of a superuser session.
	RoleExists bool
	// RoleErr is set when the role question failed. It is never read as
	// "the role does not exist".
	RoleErr error
}

// OwnerState is what a session of the owner role sees.
type OwnerState struct {
	Superuser bool
	// Pending counts objects in public and keystore that another role still
	// owns. Zero means the handover is done.
	Pending int
}

// pgProbe asks the database. A superuser session must never read or write an
// app table: the owner role owns them and can attach triggers or functions
// that would run with the superuser's rights. So the superuser connection
// asks only about pg_roles, and the handover check runs as the owner, over
// pg_catalog alone (TestOwnerQueriesTouchOnlyCatalogs checks the text).
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

func (pgProbe) Facts(ctx context.Context, databaseURL string) (Facts, error) {
	conn, done, err := connectOnce(ctx, databaseURL)
	if err != nil {
		return Facts{}, err
	}
	defer done()
	var facts Facts
	if err := conn.QueryRow(ctx, isSuperuserSQL).Scan(&facts.Superuser); err != nil {
		return Facts{}, err
	}
	if facts.Superuser {
		facts.RoleErr = conn.QueryRow(ctx, roleExistsSQL, OwnerRole).Scan(&facts.RoleExists)
	}
	return facts, nil
}

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

// The app stops connecting to Postgres as the superuser.
//
// With a superuser URL in DATABASE_URL, a start runs prisma/bootstrap/owner-role.sql
// as the superuser (creates retrospend_owner, hands it the objects), checks the
// owner can sign in, and gives everything after that the owner's URL: the
// migrations, the grants file and the app. The owner never holds CREATE on the
// database: a brand-new install is migrated by a one-shot role that does, while
// `prisma migrate deploy` runs (prepare), and is then removed; an upgrade
// migrates as the owner with no CREATE for anyone. retrospend_owner is not a
// superuser, so SQL that escapes the row-level security role lands on a role
// that cannot read files, run programs, create roles or touch other databases.
//
// This is plain Node (the image has `pg` and nothing to compile with). It is
// imported by cli.mjs, which docker-entrypoint.sh runs, and by the pg test
// harness. The owner's password is derived from the superuser's, so no new
// secret needs configuring: see deriveOwnerPassword.
//
//   constants.mjs   names and paths
//   password.mjs    the derived password, URLs, SCRAM verifiers
//   env.mjs         the environments of the app and of the migration tools
//   database.mjs    superuser connections, retries
//   roles.mjs       the owner role: make, check, sign in, password
//   handover.mjs    the handover, and whether a database is brand-new
//   window.mjs      the one-shot migration role of a brand-new install
//   bootstrap.mjs   the superuser's part of a start
//   migrate.mjs     the migrations, the grants file, and prepare (a whole start)
export * from "./bootstrap.mjs";
export * from "./constants.mjs";
export * from "./env.mjs";
export * from "./handover.mjs";
export * from "./migrate.mjs";
export * from "./password.mjs";
export {
	createOwnerRole,
	enforceOwnerRole,
	ownerProblems,
} from "./roles.mjs";
export { MIGRATOR_PREFIX, migratorRoleName } from "./window.mjs";

// What the two rollback tests and `pnpm test:regen-fixtures`
// (scripts/regen-catalog-fixtures.ts) agree on: which migration each fixture
// is the state before, and the tables the least-privilege fixture covers.

export const DEFINER_MIGRATION = "20261109500000_definer_hygiene";
export const LEAST_PRIVILEGE_MIGRATION = "20261109600000_least_privilege";

/** The tables the least-privilege migration changes; the rest of the catalog is not compared with the fixture. */
export const LEAST_PRIVILEGE_TABLES = [
	"user",
	"_prisma_migrations",
	"verification",
	"verification_token",
	"password_reset_token",
	"session",
	"account",
	"twoFactor",
	"username_history",
	"event_log",
	"app_settings",
	"invite_code",
	"system_status",
	"audit_log_entry",
	"error_report",
];

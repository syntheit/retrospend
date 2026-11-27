/**
 * The inventory of every statement that writes asset_account, by file: how
 * many statements and how each is classed for the device slice. It is the
 * list asset-account-writers.test.ts pins against a search of the repository,
 * and account-version-writers.pg.test.ts maps every file here to a named
 * version-behavior case, so a new writer fails both until it is classed.
 */
/** file: [statements, class]. */
export const WRITERS: Record<string, readonly [number, string]> = {
	// Rollback text that restores the leg trigger's function: balance only.
	"prisma/rollback/20261112100000_account_leg_half_even.sql": [
		2,
		"balance-only, trigger rollback",
	],
	// create, edit, close, reopen (3 updates) and the web delete: M6a
	"src/server/services/accounts/manage.ts": [5, "device (M6a), delete online"],
	"src/server/services/accounts/checkpoint.ts": [1, "device (M6a)"],
	"src/server/services/accounts/rate-type.mutation.ts": [2, "device (M6a)"],
	"src/server/services/accounts/update-balance.mutation.ts": [
		1,
		"device (M6a)",
	],
	"src/server/services/accounts/icon.ts": [1, "online, keeps updatedAt"],
	"src/server/services/accounts/delete-snapshot.ts": [
		2,
		"online, keeps updatedAt",
	],
	"src/server/services/envelope/debt.service.ts": [1, "online (terms)"],
	"src/server/services/income/move-in.mutation.ts": [1, "online, counted only"],
	"src/server/services/transfers/create.mutation.ts": [
		2,
		"device (M6b), counted only",
	],
	"src/server/services/transfers/delete.mutation.ts": [
		2,
		"device (M6b), counted only",
	],
};

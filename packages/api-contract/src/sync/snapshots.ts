import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { decimalStringSchema, idSchema, timestampSchema } from "../core";
import { SYNC_TAG } from "./route";

/**
 * Snapshots for the app's local copy (E2EE P16): small tables a device reads
 * whole instead of as a delta. A snapshot has no cursor, no tombstones and no
 * 410: the body is the table as of one read, and the next pull replaces it.
 * What a device cannot get from the row routes lives here: the caller's
 * participations in shared expenses, the shared money totals computed on the
 * server, and the user's settings as the figures read them.
 */

/**
 * One of the caller's participations in a shared expense, with the fields of
 * its expense that the spending figures read and nothing else: no description,
 * no payer, no other participant and no project name.
 */
export const syncShareSchema = z
	.object({
		id: idSchema.meta({ description: "The participation." }),
		expenseId: idSchema,
		shareAmount: decimalStringSchema.meta({
			description:
				"The caller's share, in `currency`. Negative on a correction entry.",
		}),
		verificationStatus: z.enum([
			"PENDING",
			"ACCEPTED",
			"REJECTED",
			"AUTO_ACCEPTED",
		]),
		currency: z.string(),
		date: timestampSchema,
		projectId: idSchema.nullable(),
		exchangeRate: decimalStringSchema.nullable().meta({
			description:
				"Units of `currency` per USD, captured when the expense was saved; null when none was.",
		}),
		expenseCategoryId: idSchema.nullable().meta({
			description:
				"The expense's category when it is the caller's own, else null: a category belongs to whoever created the expense.",
		}),
	})
	.meta({ id: "SyncShare" });

export type SyncShareDto = z.infer<typeof syncShareSchema>;

export const syncOwedSchema = z
	.union([
		z.object({
			owedToYou: moneySchema,
			youOwe: moneySchema,
		}),
		z.object({
			missingRates: z.array(currencyCodeSchema).meta({
				description:
					"Currencies someone owes in that have no rate to the home currency, so the totals cannot be read.",
			}),
		}),
	])
	.meta({
		id: "SyncOwed",
		description:
			"Owed to you and You owe in the home currency, never netted, or the currencies that keep them out. The same reading the figures give.",
	});

export type SyncOwedDto = z.infer<typeof syncOwedSchema>;

export const syncSharesSchema = z
	.object({
		items: z.array(syncShareSchema),
		owed: syncOwedSchema,
	})
	.meta({ id: "SyncShares" });

export type SyncSharesDto = z.infer<typeof syncSharesSchema>;

/** The note every snapshot shares: what makes it differ from the row routes. */
const SNAPSHOT_DESCRIPTION =
	"A snapshot, not a delta: the whole table as of one read, with no cursor and no tombstones, so it never answers 410. Pull it again to replace the last copy. Needs the `sync` session scope: a session signed in by a client that identifies as the mobile app has it, an API key, personal token or device session never does. It reaches only the caller's own data.";

export const syncSnapshotsContract = {
	shares: v1
		.route({
			method: "GET",
			path: "/sync/shares",
			operationId: "syncShares",
			tags: SYNC_TAG,
			summary: "The caller's participations in shared expenses",
			description: `Every participation of the caller in a shared expense, whatever its status and project (a rejected share and one in a hidden project are rows too; the device applies the spending rules), plus Owed to you and You owe from the same read. The owed totals are priced at the rates of the moment of the read. ${SNAPSHOT_DESCRIPTION}`,
		})
		.meta({ scope: "sync", snapshot: true })
		.output(syncSharesSchema),
};

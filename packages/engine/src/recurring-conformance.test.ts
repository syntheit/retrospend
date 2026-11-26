/**
 * The recurring conformance cases on the device: a memory store behind
 * LocalDb, the phone's poster loop for a poster step. The server runs the same
 * cases in src/server/services/__tests__/recurring-conformance.pg.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ExpenseRow } from "./expenses";
import type { LocalDb } from "./local-db";
import { bookedOf } from "./local-expense-create";
import { dump } from "./local-fixtures";
import type { MemoryStore } from "./memory-store";
import {
	type PostedRow,
	type RecurringAdapter,
	recurringCases,
} from "./recurring-conformance";
import {
	confirmRecurring,
	RECURRING_CONFIRM,
	RECURRING_SKIP,
	skipRecurring,
} from "./recurring-local";
import { open, pull, runPoster } from "./recurring-local-kit";
import type { RecurringStep } from "./recurring-vectors";
import {
	createTemplate,
	TEMPLATE_CREATE,
	TEMPLATE_UPDATE,
	updateTemplate,
} from "./template-local";

// The engine's tsconfig has no node types; a test sets the process zone.
declare const process: { env: Record<string, string | undefined> };

const originalTZ = process.env.TZ;
afterEach(() => {
	if (originalTZ === undefined) delete process.env.TZ;
	else process.env.TZ = originalTZ;
});

/** The hour of UTC midnight in each process zone a vector names: proof the zone took effect. */
const MIDNIGHT_HOUR: Record<string, number> = {
	UTC: 0,
	"Asia/Tokyo": 9,
	"Pacific/Auckland": 13,
};

const postedOf = (row: ExpenseRow): PostedRow => ({
	...bookedOf(row),
	id: row.id,
	recurringTemplateId: row.recurringTemplateId ?? null,
});

function localAdapter(): RecurringAdapter {
	let store: MemoryStore;
	let db: LocalDb;
	return {
		async reset(seed, tz, categories = []) {
			process.env.TZ = tz;
			expect(new Date("2026-12-01T00:00:00Z").getHours()).toBe(
				MIDNIGHT_HOUR[tz],
			);
			({ store, db } = await open(seed));
			await store.transaction((tx) => {
				for (const id of categories)
					tx.put("categories", {
						id,
						kind: "EXPENSE",
						name: id,
						color: "blue",
						icon: null,
						excludeByDefault: false,
					});
			});
		},
		async step(step: RecurringStep, n) {
			if (step.afterPull) await pull(store, `v${n}`);
			const before = dump(store);
			const base = { templateId: "t1", now: step.now };
			try {
				if (step.call === "skip") {
					await db.write(RECURRING_SKIP, skipRecurring(base));
					return { posted: [] };
				}
				if (step.call === "confirm") {
					const { value } = await db.write(
						RECURRING_CONFIRM,
						confirmRecurring({
							...base,
							clientId: `e${n}`,
							zone: step.zone,
							paidOn: step.paidOn,
							confirmedAmount: step.confirmedAmount,
							dueAt: step.dueAt,
						}),
					);
					return { posted: [postedOf(value.expense)] };
				}
				const run = await runPoster(db, { now: step.now, n });
				return {
					posted: run.posted.map(postedOf),
					stopped: run.stopped,
					refusal: run.refusal,
				};
			} catch (error) {
				// A refusal writes nothing.
				expect(dump(store)).toEqual(before);
				throw error;
			}
		},
		async template(op) {
			if ("create" in op)
				await db.write(TEMPLATE_CREATE, createTemplate(op.create));
			else await db.write(TEMPLATE_UPDATE, updateTemplate(op.edit));
		},
		async read(id) {
			const row = store.list("recurringTemplates").find((t) => t.id === id);
			if (!row) throw new Error(`no template ${id}`);
			return row;
		},
		async expenses() {
			return [...store.list("expenses")]
				.sort((a, b) => a.date.getTime() - b.date.getTime())
				.map(postedOf);
		},
	};
}

describe("recurring conformance (device)", () => {
	for (const c of recurringCases) it(c.name, () => c.run(localAdapter));
});

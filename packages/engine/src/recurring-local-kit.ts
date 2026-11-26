/**
 * What the device's recurring tests share: a store seeded from a vector's seed
 * with its template "t1", and the phone's poster loop (the domain plans the
 * run, then each entry is one confirm).
 */
import { expect } from "vitest";
import type { ExpenseRow } from "./expenses";
import { LocalDb } from "./local-db";
import { seededStore } from "./local-expense-create";
import type { Store } from "./port";
import {
	confirmRecurring,
	planPosterOver,
	RECURRING_CONFIRM,
} from "./recurring-local";
import type { RecurringSeed } from "./recurring-vectors";
import type { TemplateRow } from "./templates";

export const templateOf = (seed: RecurringSeed): TemplateRow => ({
	id: "t1",
	name: "Rent",
	amount: seed.template.amount,
	currency: seed.template.currency,
	frequency: seed.template.frequency,
	nextDueDate: seed.template.nextDueDate,
	anchorDay: seed.template.anchorDay,
	direction: seed.template.direction ?? "OUT",
	isActive: seed.template.isActive ?? true,
	autoPay: seed.template.autoPay ?? true,
	amountMode: seed.template.amountMode ?? "FIXED",
	categoryId: null,
	category: null,
	websiteUrl: null,
	paymentSource: null,
	version: "v1",
});

export async function open(
	seed: RecurringSeed,
	over: Partial<TemplateRow> = {},
) {
	const store = await seededStore(seed);
	await store.transaction((tx) =>
		tx.put("recurringTemplates", { ...templateOf(seed), ...over }),
	);
	return { store, db: new LocalDb(store) };
}

export const template = (store: Store) => {
	const row = store.list("recurringTemplates").find((t) => t.id === "t1");
	if (!row) throw new Error("no template");
	return row;
};

export const notProtected = async () => false;

/** A pull names the template's version again, which a local write cleared. */
export async function pull(store: Store, version: string) {
	await store.transaction((tx) =>
		tx.put("recurringTemplates", { ...template(store), version }),
	);
}

/**
 * What the phone's poster does: the domain plans the run, then each entry is
 * one confirm with the entry's due date, the auto flag and, for the first
 * entry, its stamp. A later entry's stamp is "after": a device write has none.
 */
export async function runPoster(
	db: LocalDb,
	input: {
		now: Date;
		n?: number;
		autoPost?: boolean;
		isProtected?: () => Promise<boolean>;
	},
) {
	const plan = await planPosterOver(db.reads(), {
		templateId: "t1",
		now: input.now,
		autoPost: input.autoPost ?? true,
		isProtected: input.isProtected ?? notProtected,
	});
	const posted: ExpenseRow[] = [];
	for (const entry of plan.entries) {
		const { value } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({
				templateId: "t1",
				now: input.now,
				clientId: `p${input.n ?? 0}-${entry.index}`,
				dueAt: entry.dueAt,
				auto: true,
				expectedVersion:
					"version" in entry.expectedStamp
						? entry.expectedStamp.version
						: undefined,
			}),
		);
		// The planned row is the booked row.
		expect(value.expense.homeAmount).toBe(entry.plan.entry.homeAmount);
		posted.push(value.expense);
	}
	return { posted, stopped: plan.stopped, refusal: plan.refusal, plan };
}

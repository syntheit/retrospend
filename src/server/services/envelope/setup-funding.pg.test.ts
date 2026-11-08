/**
 * envelope.setup funds the amounts set in the wizard in the same write, so the
 * preview shows what Start will hold (no second write from the client).
 * Expected values by hand, in minor units:
 *
 *   USD, Flex, start 500,000 with Spending 6,000: Not planned yet is
 *   500,000 - 6,000 = 494,000, in the preview and after the commit.
 *   USD fixture: Rent 50,000 + Dining 20,000 = 70,000 planned out of 100,000,
 *   so 30,000 stays Not planned yet; Rent holds 50,000 and Dining 20,000.
 *   ARS home, start 5,000,000 with Rent 1,500,000, Dining 750,000 and Spending
 *   600,000: planned 2,850,000, Not planned yet 5,000,000 - 2,850,000 = 2,150,000.
 *   Start with 30,000 against a 70,000 plan: only 30,000 can be planned, so
 *   Not planned yet is 0 and the movements add to 30,000.
 *   A Spending envelope with no amount funds nothing: Not planned yet stays
 *   the whole 100,000 and no movement is written.
 *   Flex, start 500,000, Spending 6,000, then a 5,000 expense in Spending:
 *   Left is 6,000 - 5,000 = 1,000, so nothing is overspent.
 *   Undo of that setup removes the book, its envelopes, its funding movements
 *   and the starting balance row.
 */
import { describe, expect, it } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { seedArsRates } from "../accounts/test-fixtures";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";
import { FIGURE_NOT_PLANNED_YET } from "./verdict";

type Seeded = Awaited<ReturnType<typeof seedUser>>;

/** The fixture's Rent and Dining with their amounts, in the Flex style that funds them. */
const flex = (s: Seeded): SetupInput => ({ ...setupInput(s), style: "FLEX" });

const spendingOnly = (target?: {
	kind: "MONTHLY";
	amountMinor: number;
	mode: "REFILL";
	cadence: "MONTH";
}): SetupInput => ({
	style: "FLEX",
	startingMoneyMinor: 500_000,
	groups: [{ key: "spending", name: "Spending", role: "SPENDING" }],
	envelopes: [
		{
			key: "spending",
			name: "Spending",
			groupKey: "spending",
			kind: "MONTHLY",
			isDefault: true,
			categoryIds: [],
			...(target ? { target } : {}),
		},
	],
});

/** Preview, then commit the same input: both Not planned yet figures and the book's own. */
async function previewThenStart(s: Seeded, input: SetupInput) {
	const run = { ...input, timeZone: "UTC" };
	const movementsBefore = await adminDb.budgetMovement.count();
	const preview = await forUser(s.user.id).preview(setupEnvelopeBook, run);
	await expect(
		adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
	).resolves.toBe(0);
	await expect(adminDb.budgetMovement.count()).resolves.toBe(movementsBefore);
	await forUser(s.user.id).apply(setupEnvelopeBook, run);
	// No book exists before the write, so the figure reads as unavailable before and only "after" is set.
	const previewed = preview.unavailable.find(
		(c) => c.id === FIGURE_NOT_PLANNED_YET,
	);
	const month = await getMonth(s.user.id);
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const moved = await adminDb.budgetMovement.findMany({
		where: { bookId: book.id },
	});
	// Movements hold major units (both currencies here have 2 decimals).
	const total = (rows: typeof moved) =>
		rows.reduce(
			(sum: number, m) => sum + Math.round(Number(m.amount) * 100),
			0,
		);
	const assigned = (name: string) => {
		const id = book.envelopes.find((e) => e.name === name)?.id;
		return total(moved.filter((m) => m.toEnvelopeId === id));
	};
	return {
		previewed: previewed?.after?.[0],
		committed: month?.toAssign.amount,
		moved,
		total,
		assigned,
	};
}

describe("envelope.setup funds the amounts set in the wizard", () => {
	it("Flex with Spending 6,000 from 500,000: preview and result both leave 494,000", async () => {
		const s = await seedUser();
		const r = await previewThenStart(
			s,
			spendingOnly({
				kind: "MONTHLY",
				amountMinor: 6_000,
				mode: "REFILL",
				cadence: "MONTH",
			}),
		);
		expect(r.previewed).toEqual({ minor: 494_000, currency: "USD" });
		expect(r.committed).toEqual({ minor: 494_000, currency: "USD" });
		expect(r.assigned("Spending")).toBe(6_000);
	});

	it("funds each envelope its own amount and leaves the rest Not planned yet", async () => {
		const s = await seedUser();
		const r = await previewThenStart(s, flex(s));
		expect(r.previewed?.minor).toBe(30_000);
		expect(r.committed?.minor).toBe(30_000);
		expect(r.assigned("Rent")).toBe(50_000);
		expect(r.assigned("Dining")).toBe(20_000);
	});

	it("an ARS home currency funds in ARS: 5,000,000 less 2,850,000 is 2,150,000", async () => {
		const s = await seedUser();
		await adminDb.user.update({
			where: { id: s.user.id },
			data: { homeCurrency: "ARS" },
		});
		// The shared ARS rates: the rate table is global, so other files in
		// this worker must keep reading the same rows.
		await seedArsRates();
		const input = flex(s);
		const r = await previewThenStart(s, {
			...input,
			startingMoneyMinor: 5_000_000,
			envelopes: input.envelopes.map((e) => {
				const amountMinor = { rent: 1_500_000, dining: 750_000 }[e.key];
				if (e.key === "spending")
					return {
						...e,
						target: {
							kind: "MONTHLY",
							amountMinor: 600_000,
							mode: "REFILL",
							cadence: "MONTH",
						},
					};
				return e.target?.kind === "MONTHLY" && amountMinor
					? { ...e, target: { ...e.target, amountMinor } }
					: e;
			}),
		});
		expect(r.previewed).toEqual({ minor: 2_150_000, currency: "ARS" });
		expect(r.committed).toEqual({ minor: 2_150_000, currency: "ARS" });
		expect(r.assigned("Rent")).toBe(1_500_000);
		expect(r.assigned("Dining")).toBe(750_000);
		expect(r.assigned("Spending")).toBe(600_000);
	});

	it("a plan that costs more than you start with plans only what there is", async () => {
		const s = await seedUser();
		const r = await previewThenStart(s, {
			...flex(s),
			startingMoneyMinor: 30_000,
		});
		expect(r.previewed?.minor).toBe(0);
		expect(r.committed?.minor).toBe(0);
		expect(r.total(r.moved)).toBe(30_000);
	});

	it("an envelope with no amount funds nothing", async () => {
		const s = await seedUser();
		const r = await previewThenStart(s, {
			...spendingOnly(),
			startingMoneyMinor: 100_000,
		});
		expect(r.committed?.minor).toBe(100_000);
		expect(r.moved).toHaveLength(0);
	});

	it("an expense inside the planned amount leaves Spending with what is left and nothing overspent", async () => {
		const s = await seedUser();
		await previewThenStart(
			s,
			spendingOnly({
				kind: "MONTHLY",
				amountMinor: 6_000,
				mode: "REFILL",
				cadence: "MONTH",
			}),
		);
		await addRow(s.user.id, { amount: 50 });
		const month = await getMonth(s.user.id);
		const spending = month?.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.name === "Spending");
		expect(spending?.left).toEqual({ minor: 1_000, currency: "USD" });
		expect(spending?.status).not.toBe("OVERSPENT");
		expect(month?.verdict.over.minor).toBe(0);
		expect(month?.verdict.overEnvelopes).toEqual([]);
	});

	it("undo removes the book, its envelopes, its funding and the starting balance", async () => {
		const s = await seedUser();
		const run = {
			...spendingOnly({
				kind: "MONTHLY",
				amountMinor: 6_000,
				mode: "REFILL",
				cadence: "MONTH",
			}),
			timeZone: "UTC",
		};
		const { undo } = await forUser(s.user.id).apply(setupEnvelopeBook, run);
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
		});
		await expect(
			adminDb.budgetMovement.count({ where: { bookId: book.id } }),
		).resolves.toBe(1);
		expect(undo.kind).toBe("revert");
		if (undo.kind !== "revert") return;
		expect(undo.rows.map((r) => r.table)).toEqual(["budget_book", "expense"]);

		// The token's rows, deleted in its order as the user.
		await userTransaction(adminDb, s.user.id, async (tx) => {
			for (const row of undo.rows) {
				if (row.table === "budget_book")
					await tx.budgetBook.delete({ where: { id: row.id } });
				else await tx.expense.delete({ where: { id: row.id } });
			}
		});

		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(0);
		await expect(
			adminDb.envelope.count({ where: { bookId: book.id } }),
		).resolves.toBe(0);
		await expect(
			adminDb.budgetMovement.count({ where: { bookId: book.id } }),
		).resolves.toBe(0);
		await expect(
			adminDb.expense.count({ where: { userId: s.user.id } }),
		).resolves.toBe(0);
	});
});

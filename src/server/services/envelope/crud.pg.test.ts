/**
 * Envelope edits on Postgres (stream 2B): combine, archive, create and
 * update, each previewed, applied and undone. USD book from August; the
 * current month c is the real one, so August and September are closed.
 * Expected values by hand (minor units):
 *
 * Start (augustBook): starting money 100,000 in August; August assigned
 * Dining 30,000, spent 10,000 (Left 20,000); September spent 5,000 (Left
 * 15,000, carried). Rent has nothing.
 * This month: assign Rent 10,000 and Dining 4,000, spend Dining 2,500 and
 * Rent 1,000.
 *   Dining Left 15,000 + 4,000 - 2,500 = 16,500
 *   Rent   Left 10,000 - 1,000        =  9,000
 *   To assign   100,000 - (30,000 + 10,000 + 4,000) = 56,000
 *   invariant   56,000 + 25,500 = 81,500 = 100,000 - 18,500 spent.
 *
 * Combine Dining into Rent ("Home"): Dining's category moves, so Dining's
 * 2,500 of spending lands on Rent; Dining then holds 15,000 + 4,000 = 19,000
 * and Rent 10,000 - 1,000 - 2,500 = 6,500; the 19,000 moves to Rent, which
 * ends at 25,500 = 9,000 + 16,500. To assign stays 56,000. September still
 * shows Dining 15,000 and Rent 0 (B7). The two targets (Set aside 500.00 and
 * Refill 200.00) do not add up, so Rent keeps its own and one is dropped.
 *
 * Archive Dining: 2,500 of spending falls to Spending, which is paid back
 * (no Left but Dining's moves); Dining's 16,500 goes to To assign: 72,500;
 * Rent 9,000, Spending 0; 72,500 + 9,000 = 81,500.
 *
 * Create Coffee over a new category with 30.00 spent this month (Spending
 * holds 5,000 - 3,000 = 2,000 then): Spending stays 2,000 and Coffee 0, with
 * 3,000 assigned to Coffee out of Spending. Update: Coffee also covers
 * Dining: 2,500 moves from Dining to Coffee the same way.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import {
	addRow,
	augustBook,
	invariantAt,
	seedUser,
} from "./__tests__/pg-fixture";
import {
	archiveEnvelopeMutation,
	createEnvelopeMutation,
	mergeEnvelopesMutation,
	undoChangeMutation,
	updateEnvelopeMutation,
} from "./crud.mutation";
import { computeBook } from "./engine";
import { loadBook } from "./inputs";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";

const usd = (minor: number) => ({ minor, currency: "USD" });
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);

type View = Awaited<ReturnType<typeof getMonth>>;
const rowOf = (m: View, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);
const leftOf = (m: View, id: string) => rowOf(m, id)?.left.minor;

/** Left of an envelope in any month, from a full engine pass (closed months route by their own snapshot). */
function leftIn(userId: string, month: number, envelopeId: string) {
	return userTransaction(adminDb, userId, async (tx) => {
		const l = await loadBook(tx, userId, { now: new Date(), needFrom: 0 });
		if (!l) throw new Error("no book");
		return computeBook(l.input).month(month).envelopes.get(envelopeId)?.left;
	});
}

async function assign(
	bookId: string,
	userId: string,
	to: string,
	minor: number,
) {
	await adminDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId,
			month: current,
			toEnvelopeId: to,
			amount: minor / 100,
			kind: "ASSIGN",
			actorUserId: userId,
		},
	});
}

/** The August book plus this month's money and spending (see the header). */
async function thisMonth() {
	const b = await augustBook();
	const env = await adminDb.envelope.findMany({ where: { bookId: b.bookId } });
	const id = Object.fromEntries(env.map((e) => [e.name, e.id])) as Record<
		"Rent" | "Dining" | "Spending",
		string
	>;
	await assign(b.bookId, b.user.id, id.Rent, 10_000);
	await assign(b.bookId, b.user.id, id.Dining, 4_000);
	await addRow(b.user.id, { amount: 25, categoryId: b.dining });
	await addRow(b.user.id, { amount: 10, categoryId: b.rent });
	return { ...b, id };
}

const sides = async (userId: string) => {
	const s = await invariantAt(userId);
	expect(s.budget).toBe(s.ledger);
	return s;
};

describe("combine envelopes", () => {
	let b: Awaited<ReturnType<typeof thisMonth>>;
	let before: View;
	let closedBefore: Array<number | undefined>;
	const changeId = randomUUID();

	beforeAll(async () => {
		b = await thisMonth();
		before = await getMonth(b.user.id);
		closedBefore = [
			await leftIn(b.user.id, 202608, b.id.Dining),
			await leftIn(b.user.id, 202609, b.id.Dining),
			await leftIn(b.user.id, 202609, b.id.Rent),
		];
	});

	it("starts from the hand-derived month", async () => {
		expect(leftOf(before, b.id.Dining)).toBe(16_500);
		expect(leftOf(before, b.id.Rent)).toBe(9_000);
		expect(before?.toAssign.amount).toEqual(usd(56_000));
		expect(closedBefore).toEqual([20_000, 15_000, 0]);
		await expect(sides(b.user.id)).resolves.toMatchObject({ ledger: 81_500 });
	});

	const input = () => ({
		id: changeId,
		intoId: b.id.Rent,
		fromIds: [b.id.Dining],
		name: "Home",
	});

	it("the preview lists every change and writes nothing", async () => {
		const p = await forUser(b.user.id).preview(mergeEnvelopesMutation, input());
		expect(p.value.left).toEqual([
			{ id: b.id.Rent, before: usd(9_000), after: usd(25_500) },
			{ id: b.id.Dining, before: usd(16_500), after: usd(0) },
		]);
		expect(p.value.toAssign).toEqual({
			before: usd(56_000),
			after: usd(56_000),
		});
		expect(p.value.routed).toEqual([
			{ categoryId: b.dining, from: b.id.Dining, to: b.id.Rent },
		]);
		expect(p.value.renamed).toEqual({ from: "Rent", to: "Home" });
		expect(p.value.target).toMatchObject({ summed: 0, dropped: 1 });
		expect(p.value.target.after).toEqual(p.value.target.before);
		expect(p.value.movements).toHaveLength(1);
		expect(p.value.movements[0]).toMatchObject({
			from: b.id.Dining,
			to: b.id.Rent,
			amount: usd(19_000),
			kind: "ARCHIVE",
		});
		// What the budget holds does not move in an edit.
		expect(p.changes.find((c) => c.id === "budget.holds")).toBeUndefined();
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: b.id.Dining } }),
		).resolves.toMatchObject({ archivedAt: null });
		await expect(
			adminDb.envelopeChange.count({ where: { id: changeId } }),
		).resolves.toBe(0);
	});

	it("apply is the preview: Rent holds 25,500, Dining is archived, To assign is 56,000", async () => {
		const p = await forUser(b.user.id).preview(mergeEnvelopesMutation, input());
		const a = await forUser(b.user.id).apply(mergeEnvelopesMutation, input());
		expect(a.value.left).toEqual(p.value.left);
		expect(a.value.toAssign).toEqual(p.value.toAssign);
		expect(a.value.routed).toEqual(p.value.routed);
		expect(a.undo).toMatchObject({
			mutation: "envelope.undoChange",
			rows: [{ table: "envelope_change", id: changeId }],
		});
		const m = await getMonth(b.user.id);
		expect(leftOf(m, b.id.Rent)).toBe(25_500);
		expect(rowOf(m, b.id.Rent)).toMatchObject({ name: "Home" });
		expect(rowOf(m, b.id.Rent)?.categoryIds.sort()).toEqual(
			[b.rent, b.dining].sort(),
		);
		expect(rowOf(m, b.id.Dining)).toBeUndefined();
		expect(m?.toAssign.amount).toEqual(usd(56_000));
		await expect(sides(b.user.id)).resolves.toMatchObject({ ledger: 81_500 });
	});

	it("closed months keep the routing they closed with", async () => {
		await expect(leftIn(b.user.id, 202608, b.id.Dining)).resolves.toBe(
			closedBefore[0],
		);
		await expect(leftIn(b.user.id, 202609, b.id.Dining)).resolves.toBe(
			closedBefore[1],
		);
		await expect(leftIn(b.user.id, 202609, b.id.Rent)).resolves.toBe(
			closedBefore[2],
		);
	});

	it("the undo puts everything back, exactly", async () => {
		const a = await forUser(b.user.id).apply(undoChangeMutation, {
			id: changeId,
		});
		expect(a.value).toMatchObject({ changeId, kind: "MERGE" });
		const m = await getMonth(b.user.id);
		expect(leftOf(m, b.id.Dining)).toBe(16_500);
		expect(leftOf(m, b.id.Rent)).toBe(9_000);
		expect(rowOf(m, b.id.Rent)).toMatchObject({ name: "Rent" });
		expect(rowOf(m, b.id.Dining)?.categoryIds).toEqual([b.dining]);
		expect(rowOf(m, b.id.Rent)?.categoryIds).toEqual([b.rent]);
		expect(m?.toAssign.amount).toEqual(usd(56_000));
		await expect(sides(b.user.id)).resolves.toMatchObject({ ledger: 81_500 });
		await expect(
			forUser(b.user.id).apply(undoChangeMutation, { id: changeId }),
		).rejects.toMatchObject({ code: "ALREADY_UNDONE" });
	});

	it("another person cannot undo it, and a reused id is refused", async () => {
		const other = await seedUser();
		await expect(
			forUser(other.user.id).apply(undoChangeMutation, { id: changeId }),
		).rejects.toMatchObject({ code: "NO_BOOK" });
		await expect(
			forUser(b.user.id).apply(mergeEnvelopesMutation, input()),
		).rejects.toMatchObject({ code: "ID_REUSED" });
	});

	it("Everything else cannot be combined away", async () => {
		await expect(
			forUser(b.user.id).preview(mergeEnvelopesMutation, {
				id: randomUUID(),
				intoId: b.id.Rent,
				fromIds: [b.id.Spending],
			}),
		).rejects.toMatchObject({ code: "INVALID" });
	});
});

describe("archive an envelope", () => {
	let b: Awaited<ReturnType<typeof thisMonth>>;
	const changeId = randomUUID();

	beforeAll(async () => {
		b = await thisMonth();
		await getMonth(b.user.id);
	});

	it("its Left goes to To assign; no other envelope's Left moves", async () => {
		const input = { id: changeId, envelopeId: b.id.Dining };
		const p = await forUser(b.user.id).preview(archiveEnvelopeMutation, input);
		expect(p.value.toAssign).toEqual({
			before: usd(56_000),
			after: usd(72_500),
		});
		expect(p.value.left.find((l) => l.id === b.id.Dining)).toEqual({
			id: b.id.Dining,
			before: usd(16_500),
			after: usd(0),
		});
		expect(p.value.left.find((l) => l.id === b.id.Spending)).toEqual({
			id: b.id.Spending,
			before: usd(0),
			after: usd(0),
		});
		await forUser(b.user.id).apply(archiveEnvelopeMutation, input);
		const m = await getMonth(b.user.id);
		expect(m?.toAssign.amount).toEqual(usd(72_500));
		expect(rowOf(m, b.id.Dining)).toBeUndefined();
		expect(leftOf(m, b.id.Rent)).toBe(9_000);
		expect(leftOf(m, b.id.Spending)).toBe(0);
		await expect(sides(b.user.id)).resolves.toMatchObject({ ledger: 81_500 });
	});

	it("closed months keep Dining's history", async () => {
		await expect(leftIn(b.user.id, 202609, b.id.Dining)).resolves.toBe(15_000);
	});

	it("the undo brings it back with its money", async () => {
		await forUser(b.user.id).apply(undoChangeMutation, { id: changeId });
		const m = await getMonth(b.user.id);
		expect(leftOf(m, b.id.Dining)).toBe(16_500);
		expect(rowOf(m, b.id.Dining)?.categoryIds).toEqual([b.dining]);
		expect(m?.toAssign.amount).toEqual(usd(56_000));
		await expect(sides(b.user.id)).resolves.toMatchObject({ ledger: 81_500 });
	});

	it("Everything else is renamable, not archivable", async () => {
		await expect(
			forUser(b.user.id).preview(archiveEnvelopeMutation, {
				id: randomUUID(),
				envelopeId: b.id.Spending,
			}),
		).rejects.toMatchObject({ code: "INVALID" });
	});

	it("an overspent envelope is covered first", async () => {
		await addRow(b.user.id, { amount: 500, categoryId: b.rent });
		await expect(
			forUser(b.user.id).preview(archiveEnvelopeMutation, {
				id: randomUUID(),
				envelopeId: b.id.Rent,
			}),
		).rejects.toMatchObject({ code: "INVALID" });
	});
});

describe("create and update an envelope", () => {
	let b: Awaited<ReturnType<typeof thisMonth>>;
	let cafe: string;
	const coffee = randomUUID();
	const updateId = randomUUID();

	beforeAll(async () => {
		b = await thisMonth();
		cafe = (
			await adminDb.category.create({
				data: { name: "Cafe", color: "blue", userId: b.user.id },
			})
		).id;
		await assign(b.bookId, b.user.id, b.id.Spending, 5_000);
		await addRow(b.user.id, { amount: 30, categoryId: cafe });
		await getMonth(b.user.id);
	});

	it("Spending holds 2,000 before the new envelope", async () => {
		const m = await getMonth(b.user.id);
		expect(leftOf(m, b.id.Spending)).toBe(2_000);
	});

	it("the new envelope takes the category and its spending, with the money that paid for it", async () => {
		const input = {
			id: coffee,
			name: "Coffee",
			groupId: null,
			kind: "NONE" as const,
			categoryIds: [cafe],
		};
		const p = await forUser(b.user.id).preview(createEnvelopeMutation, input);
		expect(p.value.routed).toEqual([
			{ categoryId: cafe, from: null, to: coffee },
		]);
		await expect(
			adminDb.envelope.count({ where: { id: coffee } }),
		).resolves.toBe(0);
		const a = await forUser(b.user.id).apply(createEnvelopeMutation, input);
		expect(a.value.left).toEqual(p.value.left);
		const m = await getMonth(b.user.id);
		expect(leftOf(m, b.id.Spending)).toBe(2_000);
		expect(rowOf(m, coffee)).toMatchObject({
			name: "Coffee",
			assigned: usd(3_000),
			activity: usd(-3_000),
			left: usd(0),
			categoryIds: [cafe],
		});
		expect(m?.toAssign.amount).toEqual(usd(56_000 - 5_000));
		await sides(b.user.id);
	});

	it("update renames it and adds Dining, moving Dining's spending along", async () => {
		const input = {
			id: updateId,
			envelopeId: coffee,
			name: "Cafe",
			categoryIds: [cafe, b.dining],
		};
		const p = await forUser(b.user.id).preview(updateEnvelopeMutation, input);
		expect(p.value.renamed).toEqual({ from: "Coffee", to: "Cafe" });
		expect(p.value.routed).toEqual([
			{ categoryId: b.dining, from: b.id.Dining, to: coffee },
		]);
		await forUser(b.user.id).apply(updateEnvelopeMutation, input);
		const m = await getMonth(b.user.id);
		expect(rowOf(m, coffee)).toMatchObject({ name: "Cafe", left: usd(0) });
		expect(leftOf(m, b.id.Dining)).toBe(16_500);
		expect(rowOf(m, b.id.Dining)?.categoryIds).toEqual([]);
		await sides(b.user.id);
	});

	it("undoing the update restores the name and the categories", async () => {
		await forUser(b.user.id).apply(undoChangeMutation, { id: updateId });
		const m = await getMonth(b.user.id);
		expect(rowOf(m, coffee)).toMatchObject({ name: "Coffee" });
		expect(rowOf(m, coffee)?.categoryIds).toEqual([cafe]);
		expect(rowOf(m, b.id.Dining)?.categoryIds).toEqual([b.dining]);
		expect(leftOf(m, b.id.Dining)).toBe(16_500);
		await sides(b.user.id);
	});

	it("undoing the create archives it (it has money history) and frees the category", async () => {
		await forUser(b.user.id).apply(undoChangeMutation, { id: coffee });
		const m = await getMonth(b.user.id);
		expect(rowOf(m, coffee)).toBeUndefined();
		expect(leftOf(m, b.id.Spending)).toBe(2_000);
		expect(m?.toAssign.amount).toEqual(usd(51_000));
		await sides(b.user.id);
	});

	it("an envelope with no money history is deleted by its undo", async () => {
		const id = randomUUID();
		await forUser(b.user.id).apply(createEnvelopeMutation, {
			id,
			name: "Empty",
			groupId: null,
			kind: "NONE",
			categoryIds: [],
		});
		await expect(adminDb.envelope.count({ where: { id } })).resolves.toBe(1);
		await forUser(b.user.id).apply(undoChangeMutation, { id });
		await expect(adminDb.envelope.count({ where: { id } })).resolves.toBe(0);
	});

	it("a category of someone else is refused", async () => {
		const other = await seedUser();
		await expect(
			forUser(b.user.id).preview(createEnvelopeMutation, {
				id: randomUUID(),
				name: "Stolen",
				groupId: null,
				kind: "NONE",
				categoryIds: [other.dining],
			}),
		).rejects.toMatchObject({ code: "INVALID" });
	});
});

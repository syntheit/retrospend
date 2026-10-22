/**
 * Guards from the P2 review on a real Postgres: next month's take-back cap,
 * history pages for one envelope, member permissions (as a VIEWER), the
 * same-book undo key, reused ids, and two setups racing.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assignInputSchema } from "~/lib/schemas/envelope";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { addMonths } from "./calendar";
import { assignEnvelopes, moveMoney } from "./movement.mutation";
import { getHistory, getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

type Seeded = Awaited<ReturnType<typeof seedUser>>;

async function bookOf(s: Seeded) {
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const id = (name: string) =>
		book.envelopes.find((e) => e.name === name)?.id as string;
	const month = (await getMonth(s.user.id))?.month.key as number;
	return { book, id, month, next: addMonths(month, 1) };
}

const assign = (
	s: Seeded,
	month: number,
	envelopeId: string,
	amountMinor: number,
	mode: "add" | "set" = "add",
) =>
	forUser(s.user.id).apply(assignEnvelopes, {
		batchId: randomUUID(),
		month,
		mode,
		items: [{ id: randomUUID(), envelopeId, amountMinor }],
	});

describe("review 1: nothing carried into next month goes back to To assign", () => {
	it("income 1,000 all assigned this month: next month's take-back, negative add and SET below 0 are refused", async () => {
		const s = await seedUser();
		const a = await bookOf(s);
		await assign(s, a.month, a.id("Dining"), 100_000);
		// Next month Dining shows the 1,000 carried in, none of it assigned there.
		const back = {
			id: randomUUID(),
			month: a.next,
			from: a.id("Dining"),
			to: null,
			amountMinor: 100_000,
			kind: "UNASSIGN" as const,
		};
		await expect(
			forUser(s.user.id).apply(moveMoney, back),
		).rejects.toMatchObject({ code: "OVER_CAP", availableMinor: 0 });
		await expect(
			assign(s, a.next, a.id("Dining"), -100_000),
		).rejects.toMatchObject({ code: "OVER_CAP" });
		await expect(
			assign(s, a.next, a.id("Dining"), -10_000, "set"),
		).rejects.toMatchObject({ code: "OVER_CAP" });
		const view = await getMonth(s.user.id);
		expect(view?.toAssign.amount.minor).toBe(0);
	});

	it("what was assigned next month can come back", async () => {
		const s = await seedUser();
		const a = await bookOf(s);
		await assign(s, a.next, a.id("Rent"), 30_000);
		expect((await getMonth(s.user.id))?.toAssign.amount.minor).toBe(70_000);
		await forUser(s.user.id).apply(moveMoney, {
			id: randomUUID(),
			month: a.next,
			from: a.id("Rent"),
			to: null,
			amountMinor: 30_000,
			kind: "UNASSIGN",
		});
		expect((await getMonth(s.user.id))?.toAssign.amount.minor).toBe(100_000);
	});
});

describe("review 2: history pages stay on one envelope", () => {
	it("page 2 for Dining holds only Dining rows", async () => {
		const s = await seedUser();
		const a = await bookOf(s);
		for (const name of ["Dining", "Rent", "Dining", "Rent", "Dining"])
			await assign(s, a.month, a.id(name), 1_000);
		const first = await getHistory(s.user.id, {
			envelopeId: a.id("Dining"),
			limit: 2,
		});
		expect(first.items).toHaveLength(2);
		const second = await getHistory(s.user.id, {
			envelopeId: a.id("Dining"),
			limit: 2,
			cursor: first.nextCursor ?? undefined,
		});
		expect(second.items).toHaveLength(1);
		expect(second.items.every((i) => i.to === a.id("Dining"))).toBe(true);
		expect(second.nextCursor).toBeNull();
	});
});

describe("review 3: member permissions (as a VIEWER)", () => {
	it("a viewer cannot delete the book or another member, cannot take over the book, and may leave", async () => {
		const alice = await seedUser();
		const a = await bookOf(alice);
		const { user: carol, db: carolDb } = await createTestUser();
		await adminDb.budgetMember.create({
			data: { bookId: a.book.id, userId: carol.id, role: "VIEWER" },
		});

		await expect(
			carolDb.budgetBook.deleteMany({ where: { id: a.book.id } }),
		).resolves.toEqual({ count: 0 });
		await expect(
			adminDb.budgetBook.count({ where: { id: a.book.id } }),
		).resolves.toBe(1);
		await expect(
			carolDb.budgetMember.deleteMany({
				where: { bookId: a.book.id, userId: alice.user.id },
			}),
		).resolves.toEqual({ count: 0 });
		await expect(
			carolDb.budgetMember.updateMany({
				where: { bookId: a.book.id, userId: carol.id },
				data: { role: "OWNER" },
			}),
		).resolves.toEqual({ count: 0 });
		await expect(
			carolDb.budgetBook.updateMany({
				where: { id: a.book.id },
				data: { createdById: carol.id },
			}),
		).rejects.toThrow(/keeps its id and creator/);
		await expect(
			carolDb.budgetMember.deleteMany({
				where: { bookId: a.book.id, userId: carol.id },
			}),
		).resolves.toEqual({ count: 1 });
	});

	it("the owner removes a member and deletes the book", async () => {
		const alice = await seedUser();
		const a = await bookOf(alice);
		const { user: carol } = await createTestUser();
		await adminDb.budgetMember.create({
			data: { bookId: a.book.id, userId: carol.id, role: "VIEWER" },
		});
		await expect(
			alice.db.budgetMember.deleteMany({
				where: { bookId: a.book.id, userId: carol.id },
			}),
		).resolves.toEqual({ count: 1 });
		await expect(
			alice.db.budgetBook.deleteMany({ where: { id: a.book.id } }),
		).resolves.toEqual({ count: 1 });
	});

	it("an undo row can only revert a movement of its own book", async () => {
		const alice = await seedUser();
		const bob = await seedUser();
		const a = await bookOf(alice);
		const b = await bookOf(bob);
		const done = await assign(alice, a.month, a.id("Dining"), 1_000);
		const original = done.value.movements[0]?.id as string;
		await expect(
			adminDb.budgetMovement.create({
				data: {
					id: randomUUID(),
					bookId: b.book.id,
					month: b.month,
					fromEnvelopeId: b.id("Dining"),
					amount: "10",
					kind: "UNDO",
					revertsId: original,
					actorUserId: bob.user.id,
				},
			}),
		).rejects.toThrow(/foreign key/i);
	});
});

describe("review 5: reused ids", () => {
	it("a batch id sent again with other content is refused; a movement id reused in a new batch too", async () => {
		const s = await seedUser();
		const a = await bookOf(s);
		const itemId = randomUUID();
		const input = {
			batchId: randomUUID(),
			month: a.month,
			mode: "add" as const,
			items: [{ id: itemId, envelopeId: a.id("Dining"), amountMinor: 1_000 }],
		};
		await forUser(s.user.id).apply(assignEnvelopes, input);
		await expect(
			forUser(s.user.id).apply(assignEnvelopes, {
				...input,
				items: [
					{ ...input.items[0], amountMinor: 2_000 } as (typeof input.items)[0],
				],
			}),
		).rejects.toMatchObject({ code: "ID_REUSED" });
		await expect(
			forUser(s.user.id).apply(assignEnvelopes, {
				...input,
				batchId: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "ID_REUSED" });
	});

	it("the contract refuses one envelope twice in a batch", () => {
		const items = [
			{ id: randomUUID(), envelopeId: "e1", amountMinor: 1 },
			{ id: randomUUID(), envelopeId: "e1", amountMinor: 2 },
		];
		expect(
			assignInputSchema.safeParse({
				batchId: randomUUID(),
				month: 202610,
				mode: "add",
				items,
			}).success,
		).toBe(false);
	});
});

describe("review 6: two setups at once", () => {
	it("one book is created; the other setup reads as BOOK_EXISTS, not a crash", async () => {
		const s = await seedUser();
		const go = () =>
			forUser(s.user.id).apply(setupEnvelopeBook, {
				...setupInput(s),
				timeZone: "UTC",
			});
		const results = await Promise.allSettled([go(), go()]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const failed = results.find((r) => r.status === "rejected");
		expect(failed && "reason" in failed ? failed.reason : null).toMatchObject({
			code: "BOOK_EXISTS",
		});
		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(1);
	});
});

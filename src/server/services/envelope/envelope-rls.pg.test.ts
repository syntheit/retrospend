/**
 * Who can see and change a book (RLS, D33), with a second household member,
 * the append-only ledger, the same-book foreign keys, and two writers racing
 * for one envelope under the book lock.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { assignEnvelopes, moveMoney } from "./movement.mutation";
import { getMonth } from "./read.service";
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
	return { book, id, month };
}

const movement = (
	bookId: string,
	actorUserId: string,
	to: string,
	month: number,
) => ({
	id: randomUUID(),
	bookId,
	month,
	toEnvelopeId: to,
	amount: "1",
	kind: "ASSIGN" as const,
	actorUserId,
});

describe("envelope RLS", () => {
	let alice: Seeded;
	let bob: Seeded;
	let a: Awaited<ReturnType<typeof bookOf>>;
	let b: Awaited<ReturnType<typeof bookOf>>;

	beforeAll(async () => {
		alice = await seedUser();
		bob = await seedUser();
		a = await bookOf(alice);
		b = await bookOf(bob);
		await forUser(alice.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: a.month,
			mode: "add",
			items: [
				{ id: randomUUID(), envelopeId: a.id("Dining"), amountMinor: 1_000 },
			],
		});
	});

	it("a non-member sees none of another user's book tables", async () => {
		const where = { bookId: a.book.id };
		await expect(
			bob.db.budgetBook.findMany({ where: { id: a.book.id } }),
		).resolves.toEqual([]);
		await expect(bob.db.budgetMember.findMany({ where })).resolves.toEqual([]);
		await expect(bob.db.bookPeriod.findMany({ where })).resolves.toEqual([]);
		await expect(bob.db.envelopeGroup.findMany({ where })).resolves.toEqual([]);
		await expect(bob.db.envelope.findMany({ where })).resolves.toEqual([]);
		await expect(bob.db.envelopeCategory.findMany({ where })).resolves.toEqual(
			[],
		);
		await expect(bob.db.budgetMovement.findMany({ where })).resolves.toEqual(
			[],
		);
		// Bob still sees his own.
		await expect(
			bob.db.envelope.count({ where: { bookId: b.book.id } }),
		).resolves.toBe(3);
	});

	it("a non-member cannot write into another user's book or join it", async () => {
		await expect(
			bob.db.budgetMovement.create({
				data: movement(a.book.id, bob.user.id, a.id("Dining"), a.month),
			}),
		).rejects.toThrow(/row-level security/);
		await expect(
			bob.db.budgetMember.create({
				data: { bookId: a.book.id, userId: bob.user.id, role: "EDITOR" },
			}),
		).rejects.toThrow(/row-level security/);
		await expect(
			bob.db.envelope.create({
				data: { bookId: a.book.id, name: "Mine now", sortOrder: 9 },
			}),
		).rejects.toThrow(/row-level security/);
		await expect(
			bob.db.budgetBook.create({
				data: {
					currency: "USD",
					startDate: new Date(),
					startMonth: a.month,
					createdById: alice.user.id,
					isPersonal: false,
				},
			}),
		).rejects.toThrow(/row-level security/);
	});

	it("S19 seam: a second household member reads the book and writes as themselves only", async () => {
		const { user: carol, db: carolDb } = await createTestUser();
		await adminDb.budgetMember.create({
			data: { bookId: a.book.id, userId: carol.id, role: "EDITOR" },
		});
		await expect(
			carolDb.envelope.count({ where: { bookId: a.book.id } }),
		).resolves.toBe(3);
		await expect(
			carolDb.budgetMovement.count({ where: { bookId: a.book.id } }),
		).resolves.toBe(1);
		await expect(
			carolDb.budgetMovement.create({
				data: movement(a.book.id, carol.id, a.id("Dining"), a.month),
			}),
		).resolves.toBeTruthy();
		// Not as Alice, and not adding members: only owners do.
		await expect(
			carolDb.budgetMovement.create({
				data: movement(a.book.id, alice.user.id, a.id("Dining"), a.month),
			}),
		).rejects.toThrow(/row-level security/);
		const { user: dave } = await createTestUser();
		await expect(
			carolDb.budgetMember.create({
				data: { bookId: a.book.id, userId: dave.id, role: "VIEWER" },
			}),
		).rejects.toThrow(/row-level security/);
		// The owner can.
		await expect(
			alice.db.budgetMember.create({
				data: { bookId: a.book.id, userId: dave.id, role: "VIEWER" },
			}),
		).resolves.toBeTruthy();
	});

	it("the ledger is append-only for the app role (D28)", async () => {
		await expect(
			alice.db.budgetMovement.deleteMany({ where: { bookId: a.book.id } }),
		).rejects.toThrow(/permission denied/);
		await expect(
			alice.db.budgetMovement.updateMany({
				where: { bookId: a.book.id },
				data: { note: "x" },
			}),
		).rejects.toThrow(/permission denied/);
	});

	it("a movement or link can only name envelopes of its own book", async () => {
		await expect(
			adminDb.budgetMovement.create({
				data: movement(a.book.id, alice.user.id, b.id("Dining"), a.month),
			}),
		).rejects.toThrow(/foreign key/i);
		await expect(
			adminDb.envelopeCategory.create({
				data: {
					bookId: a.book.id,
					envelopeId: b.id("Rent"),
					categoryId: alice.rent,
				},
			}),
		).rejects.toThrow();
		await expect(
			adminDb.budgetMovement.create({
				data: {
					...movement(a.book.id, alice.user.id, a.id("Dining"), a.month),
					amount: "0",
				},
			}),
		).rejects.toThrow(/budget_movement_amount_check/);
	});
});

describe("concurrent writers (book advisory lock)", () => {
	it("two moves of 80 out of an envelope holding 100: one lands, one hits the cap", async () => {
		const s = await seedUser();
		const a = await bookOf(s);
		await forUser(s.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: a.month,
			mode: "add",
			items: [
				{ id: randomUUID(), envelopeId: a.id("Dining"), amountMinor: 10_000 },
			],
		});
		const out = () =>
			forUser(s.user.id).apply(moveMoney, {
				id: randomUUID(),
				month: a.month,
				from: a.id("Dining"),
				to: a.id("Spending"),
				amountMinor: 8_000,
				kind: "MOVE",
			});
		const results = await Promise.allSettled([out(), out()]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((r) => r.status === "rejected");
		expect(
			rejected && "reason" in rejected ? rejected.reason : null,
		).toMatchObject({ code: "OVER_CAP", availableMinor: 2_000 });
		const view = await getMonth(s.user.id);
		expect(
			view?.groups
				.flatMap((g) => g.envelopes)
				.find((e) => e.id === a.id("Dining"))?.left.minor,
		).toBe(2_000);
	});

	it("the same assign sent twice at once writes one batch", async () => {
		const s = await seedUser();
		const a = await bookOf(s);
		const input = {
			batchId: randomUUID(),
			month: a.month,
			mode: "add" as const,
			items: [
				{ id: randomUUID(), envelopeId: a.id("Rent"), amountMinor: 50_000 },
			],
		};
		const results = await Promise.allSettled([
			forUser(s.user.id).apply(assignEnvelopes, input),
			forUser(s.user.id).apply(assignEnvelopes, input),
		]);
		expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
		await expect(
			adminDb.budgetMovement.count({ where: { batchId: input.batchId } }),
		).resolves.toBe(1);
		expect((await getMonth(s.user.id))?.toAssign.amount.minor).toBe(50_000);
	});
});

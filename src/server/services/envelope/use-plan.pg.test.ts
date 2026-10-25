/**
 * Use my plan on money already in the pool (envelope.usePlan; owner N72),
 * with the rest choice. USD book from the fixture: starting money 1,000.00
 * (To assign 100,000), Rent Set aside 500.00 and Dining Refill 200.00.
 * Expected values by hand:
 *
 *   Leave it: Rent 50,000 + Dining 20,000 = 70,000 planned, 30,000 stays
 *   Not planned yet. Preview writes nothing; Apply writes one batch and To
 *   assign is 30,000; undoing that batch gives 100,000 back.
 *   Next month: the same 70,000 now, and the 30,000 rest is split between
 *   next month's own lines and what stays: lines for next month + the rest
 *   that stays = 30,000; To assign now = what stays; undo: 100,000.
 *   A plan for an amount above Not planned yet plans no more than there is.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { undoMovements } from "./movement.mutation";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";
import { usePlanMutation } from "./use-plan.mutation";

type Seeded = Awaited<ReturnType<typeof seedUser>>;

async function book(s: Seeded) {
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const b = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const id = (name: string) =>
		b.envelopes.find((e) => e.name === name)?.id as string;
	const c = (await getMonth(s.user.id))?.month.key as number;
	return { id, current: c };
}

const toAssign = async (s: Seeded) =>
	(await getMonth(s.user.id))?.toAssign.amount.minor;

describe("envelope.usePlan", () => {
	let s: Seeded;
	let b: Awaited<ReturnType<typeof book>>;
	beforeAll(async () => {
		s = await seedUser();
		b = await book(s);
	});

	it("Leave it: 70,000 planned, 30,000 stays; preview writes nothing; undo gives 100,000 back", async () => {
		expect(await toAssign(s)).toBe(100_000);
		const before = await adminDb.budgetMovement.count();
		const p = await forUser(s.user.id).preview(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "LEAVE",
		});
		const byEnvelope = Object.fromEntries(
			p.value.lines.map((l) => [l.envelopeId, l.amount.minor]),
		);
		expect(byEnvelope).toEqual({
			[b.id("Rent")]: 50_000,
			[b.id("Dining")]: 20_000,
		});
		expect(p.value.rest.minor).toBe(30_000);
		expect(p.value.restChoice).toBe("LEAVE");
		await expect(adminDb.budgetMovement.count()).resolves.toBe(before);

		const done = await forUser(s.user.id).apply(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "LEAVE",
		});
		expect(done.value.batchId).not.toBeNull();
		expect(await toAssign(s)).toBe(30_000);
		await forUser(s.user.id).apply(undoMovements, {
			id: crypto.randomUUID(),
			target: { batchId: done.value.batchId as string },
		});
		expect(await toAssign(s)).toBe(100_000);
	});

	it("Next month: the rest is assigned ahead or stays, never lost; undo gives 100,000 back", async () => {
		const p = await forUser(s.user.id).preview(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "NEXT_MONTH",
		});
		const ahead = p.value.lines
			.filter((l) => l.month !== b.current)
			.reduce((t, l) => t + l.amount.minor, 0);
		expect(ahead + p.value.rest.minor).toBe(30_000);
		const done = await forUser(s.user.id).apply(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "NEXT_MONTH",
		});
		expect(await toAssign(s)).toBe(done.value.rest.minor);
		await forUser(s.user.id).apply(undoMovements, {
			id: crypto.randomUUID(),
			target: { batchId: done.value.batchId as string },
		});
		expect(await toAssign(s)).toBe(100_000);
	});

	it("an amount above Not planned yet plans no more than there is, and says so", async () => {
		const asked = 10_000_000;
		const p = await forUser(s.user.id).preview(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "LEAVE",
			amountMinor: asked,
		});
		// Not planned yet holds 100,000: the targets take 70,000, 30,000 stays.
		expect(p.value.lines.reduce((t, l) => t + l.amount.minor, 0)).toBe(70_000);
		expect(p.value.rest.minor).toBe(30_000);
		expect(p.value.capped).toEqual({
			asked: { minor: asked, currency: "USD" },
			held: { minor: 100_000, currency: "USD" },
		});
	});

	it("an amount within Not planned yet is not capped", async () => {
		const p = await forUser(s.user.id).preview(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "LEAVE",
			amountMinor: 40_000,
		});
		expect(p.value.capped).toBeNull();
		expect(p.value.lines.reduce((t, l) => t + l.amount.minor, 0)).toBe(40_000);
		expect(p.value.rest.minor).toBe(0);
	});

	it("a retry with the same batch id returns the batch, never plans twice", async () => {
		const batchId = crypto.randomUUID();
		const first = await forUser(s.user.id).apply(usePlanMutation, {
			batchId,
			rest: "LEAVE",
		});
		expect(first.value.batchId).toBe(batchId);
		const after = await toAssign(s);
		const again = await forUser(s.user.id).apply(usePlanMutation, {
			batchId,
			rest: "LEAVE",
		});
		expect(again.value.replayed).toBe(true);
		expect(again.value.batchId).toBe(batchId);
		expect(await toAssign(s)).toBe(after);
		await forUser(s.user.id).apply(undoMovements, {
			id: crypto.randomUUID(),
			target: { batchId },
		});
		expect(await toAssign(s)).toBe(100_000);
	});
});

describe("envelope.usePlan with nothing in Not planned yet", () => {
	it("asking for more plans nothing and reports nothing staying", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		expect(await toAssign(s)).toBe(0);
		const asked = 10_000_000;
		const p = await forUser(s.user.id).preview(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "LEAVE",
			amountMinor: asked,
		});
		expect(p.value.lines).toEqual([]);
		expect(p.value.rest.minor).toBe(0);
		expect(p.value.batchId).toBeNull();
		expect(p.value.capped).toEqual({
			asked: { minor: asked, currency: "USD" },
			held: { minor: 0, currency: "USD" },
		});
		const before = await adminDb.budgetMovement.count();
		await forUser(s.user.id).apply(usePlanMutation, {
			batchId: crypto.randomUUID(),
			rest: "LEAVE",
			amountMinor: asked,
		});
		expect(await adminDb.budgetMovement.count()).toBe(before);
	});
});

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
			rest: "NEXT_MONTH",
		});
		const ahead = p.value.lines
			.filter((l) => l.month !== b.current)
			.reduce((t, l) => t + l.amount.minor, 0);
		expect(ahead + p.value.rest.minor).toBe(30_000);
		const done = await forUser(s.user.id).apply(usePlanMutation, {
			rest: "NEXT_MONTH",
		});
		expect(await toAssign(s)).toBe(done.value.rest.minor);
		await forUser(s.user.id).apply(undoMovements, {
			id: crypto.randomUUID(),
			target: { batchId: done.value.batchId as string },
		});
		expect(await toAssign(s)).toBe(100_000);
	});

	it("an amount above Not planned yet plans no more than there is", async () => {
		const p = await forUser(s.user.id).preview(usePlanMutation, {
			rest: "LEAVE",
			amountMinor: 40_000,
		});
		const planned = p.value.lines.reduce((t, l) => t + l.amount.minor, 0);
		expect(planned + p.value.rest.minor).toBe(40_000);
	});
});

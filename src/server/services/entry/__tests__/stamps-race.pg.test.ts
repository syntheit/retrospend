/**
 * Stamps that always move, on the compare-and-set of each guarded table. Two
 * updates of one row in the same millisecond used to store one stamp, so a
 * write that held the first stamp passed the check after the second update had
 * overwritten the row. Each case writes the stamp twice with the same value
 * (what a same-millisecond edit from another client does), then holds the
 * first stamp against the table's own guard: the guard must refuse, and a
 * probe mutation with no check of its own proves nothing else did.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	expense,
	sharedTx,
} from "~/server/services/category/__tests__/merge-kit";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	removeSelfMutation,
	restoreSelfMutation,
} from "../../shared-expenses/remove-self.mutation";
import { guardedExpense, guardedShared } from "../guarded.mutation";

const T = new Date("2026-03-01T10:00:00.000Z");
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const STALE = "stale stamp";
const stale = () => new Error(STALE);

afterEach(() => vi.useRealTimers());

/** A mutation with no check of its own: whether it ran says whether the guard let it. */
function probe(change?: (tx: Prisma.TransactionClient, id: string) => unknown) {
	const ran = vi.fn();
	const mutation: MoneyMutation<{ id: string }, { id: string }> = {
		id: "stamps.probe",
		touches: [],
		run: async (tx, input) => {
			ran();
			await change?.(tx as Prisma.TransactionClient, input.id);
			return {
				value: { id: input.id },
				undo: { kind: "revert", mutation: "stamps.probe", rows: [] },
			};
		},
	};
	return { mutation, ran };
}

describe("an expense", () => {
	async function twoEditsInOneMillisecond() {
		const me = await arsUser();
		const row = await expense(me, null, 10, { updatedAt: T });
		// The phone's own edit leaves stamp S; the web's edit lands in the same
		// millisecond, so it asks for S too.
		const S = plus(T, 5);
		await fixtureDb.expense.update({
			where: { id: row.id },
			data: { title: "phone", updatedAt: S },
		});
		await fixtureDb.expense.update({
			where: { id: row.id },
			data: { title: "web", updatedAt: S },
		});
		const stored = await adminDb.expense.findUniqueOrThrow({
			where: { id: row.id },
		});
		return { me, id: row.id, S, stored };
	}

	it("the second same-millisecond edit stores a later stamp, and the first stamp no longer passes guardedExpense", async () => {
		const { me, id, S, stored } = await twoEditsInOneMillisecond();
		expect(stored.updatedAt.getTime()).toBe(S.getTime() + 1);

		const held = probe();
		await expect(
			forUser(me).apply(
				guardedExpense(held.mutation, S.toISOString(), stale),
				{ id },
			),
		).rejects.toThrow(STALE);
		expect(held.ran).not.toHaveBeenCalled();

		// The stamp the row has now passes.
		const ok = probe();
		await forUser(me).apply(
			guardedExpense(ok.mutation, stored.updatedAt.toISOString(), stale),
			{ id },
		);
		expect(ok.ran).toHaveBeenCalledTimes(1);
	});

	it("a guarded write with the app clock behind the stored stamp moves it forward by a millisecond", async () => {
		const me = await arsUser();
		const row = await expense(me, null, 10, { updatedAt: plus(T, 3_600_000) });
		vi.useFakeTimers({ toFake: ["Date"], now: T });
		const write = probe((tx, id) =>
			tx.expense.update({
				where: { id },
				data: { excludeFromAnalytics: true },
			}),
		);
		const done = await forUser(me).apply(
			guardedExpense(write.mutation, plus(T, 3_600_000).toISOString(), stale),
			{ id: row.id },
		);
		expect(done.value.updatedAt).toBe(plus(T, 3_600_001).toISOString());
	});
});

describe("a shared expense", () => {
	it("the second same-millisecond edit stores a later stamp, and the first stamp no longer passes guardedShared", async () => {
		const me = await arsUser();
		const row = await sharedTx(me, null, { updatedAt: T });
		const S = plus(T, 5);
		await fixtureDb.sharedTransaction.update({
			where: { id: row.id },
			data: { description: "phone", updatedAt: S },
		});
		await fixtureDb.sharedTransaction.update({
			where: { id: row.id },
			data: { description: "web", updatedAt: S },
		});
		const stored = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.updatedAt.getTime()).toBe(S.getTime() + 1);

		const held = probe();
		await expect(
			forUser(me).apply(
				guardedShared(held.mutation, S.toISOString(), stale),
				{ id: row.id },
			),
		).rejects.toThrow(STALE);
		expect(held.ran).not.toHaveBeenCalled();
	});
});

describe("the remove-me undo", () => {
	it("an edit in the same millisecond as the removal's stamp refuses the restore", async () => {
		const ana = await createTestUser();
		const ben = await createTestUser();
		const made = await adminDb.sharedTransaction.create({
			data: {
				description: "Dinner",
				amount: "100",
				currency: "USD",
				date: new Date("2026-10-10"),
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				updatedAt: T,
				splitParticipants: {
					create: [ana, ben].map((u) => ({
						participantType: "user" as const,
						participantId: u.user.id,
						shareAmount: "50",
						verificationStatus: "ACCEPTED" as const,
					})),
				},
			},
		});
		const { value } = await forUser(ben.user.id).apply(removeSelfMutation, {
			transactionId: made.id,
			confirmBalanceChange: true,
		});
		// The removal left stamp S; the creator's edit asks for the same one.
		const S = new Date(value.updatedAt);
		await ana.db.sharedTransaction.update({
			where: { id: made.id },
			data: { description: "Dinner, edited", updatedAt: S },
		});

		await expect(
			forUser(ben.user.id).apply(restoreSelfMutation, {
				transactionId: made.id,
				removed: value.removed,
				expectedUpdatedAt: value.updatedAt,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			adminDb.splitParticipant.count({ where: { transactionId: made.id } }),
		).resolves.toBe(1);
	});
});

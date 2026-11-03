/**
 * Deleting your own shared expense with keepForUndo hands back a stash, and
 * sharedExpense.restore (the pane's Undo) puts the expense and its shares
 * back as they were. The stash works once.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	arsUser,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import {
	createSharedExpense,
	deleteSharedExpense,
	restoreSharedExpense,
} from "~/server/services/entry/shared.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";

beforeAll(seedArsRates);

describe("Undo of a shared expense delete", () => {
	it("brings the expense and its shares back, once", async () => {
		const { user } = await arsUser();
		const { user: ben } = await createTestUser();
		const who = (id: string) => ({
			participantType: "user" as const,
			participantId: id,
		});
		const created = await forUser(user.id).apply(createSharedExpense, {
			amount: 9000,
			currency: "ARS",
			description: `Cena ${randomUUID()}`,
			date: TODAY,
			paidBy: who(user.id),
			splitWith: [who(user.id), who(ben.id)],
			splitMode: "EQUAL",
		});
		const id = created.value.id;
		const gone = await forUser(user.id).apply(deleteSharedExpense, {
			id,
			confirmUnsettled: true,
			keepForUndo: true,
		});
		expect(gone.value.stash).not.toBeNull();
		expect(
			await adminDb.sharedTransaction.findUnique({ where: { id } }),
		).toBeNull();

		const stash = gone.value.stash as string;
		await forUser(user.id).apply(restoreSharedExpense, { stash });
		const back = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id },
			include: { splitParticipants: true },
		});
		expect(Number(back.amount)).toBe(9000);
		expect(back.splitParticipants.map((p) => p.participantId).sort()).toEqual(
			[user.id, ben.id].sort(),
		);

		await expect(
			forUser(user.id).apply(restoreSharedExpense, { stash }),
		).rejects.toThrow();
	});

	it("gives no stash when Undo was not asked for", async () => {
		const { user } = await arsUser();
		const created = await forUser(user.id).apply(createSharedExpense, {
			amount: 1000,
			currency: "ARS",
			description: "Solo",
			date: TODAY,
			paidBy: { participantType: "user", participantId: user.id },
			splitWith: [{ participantType: "user", participantId: user.id }],
			splitMode: "EQUAL",
		});
		const gone = await forUser(user.id).apply(deleteSharedExpense, {
			id: created.value.id,
			confirmUnsettled: true,
		});
		expect(gone.value.stash).toBeNull();
	});

	it("does not let another user restore with the stash", async () => {
		const { user } = await arsUser();
		const { user: other } = await createTestUser();
		const created = await forUser(user.id).apply(createSharedExpense, {
			amount: 500,
			currency: "ARS",
			description: "Mine",
			date: TODAY,
			paidBy: { participantType: "user", participantId: user.id },
			splitWith: [{ participantType: "user", participantId: user.id }],
			splitMode: "EQUAL",
		});
		const gone = await forUser(user.id).apply(deleteSharedExpense, {
			id: created.value.id,
			confirmUnsettled: true,
			keepForUndo: true,
		});
		await expect(
			forUser(other.id).apply(restoreSharedExpense, {
				stash: gone.value.stash as string,
			}),
		).rejects.toThrow();
		// The owner can still use it: the failed try took nothing.
		await forUser(user.id).apply(restoreSharedExpense, {
			stash: gone.value.stash as string,
		});
	});

	it("takes only rows the stash module wrote, not a client key", async () => {
		const { user } = await arsUser();
		const stash = randomUUID();
		await adminDb.idempotencyKey.create({
			data: {
				userId: user.id,
				key: `undo-stash:${stash}`,
				requestHash: "client-request",
				completedAt: new Date(),
				status: 200,
				responseBody: { fake: true },
				expiresAt: new Date(Date.now() + 60_000),
			},
		});
		await expect(
			forUser(user.id).apply(restoreSharedExpense, { stash }),
		).rejects.toThrow();
	});
});

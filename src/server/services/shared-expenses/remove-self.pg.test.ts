/**
 * The remove-me undo on Postgres. It puts the share back only while the
 * expense is as the removal left it, and that has to hold when an edit
 * commits while the undo runs: the undo takes the expense's row lock before
 * it reads the stamp, so it waits for the edit and then sees the new stamp.
 */
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	removeSelfMutation,
	restoreSelfMutation,
} from "./remove-self.mutation";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let ana: TestUser; // creator and payer
let ben: TestUser; // removes himself

beforeAll(async () => {
	ana = await createTestUser();
	ben = await createTestUser();
});

async function dinner() {
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
	return made.id;
}

const shares = (transactionId: string) =>
	adminDb.splitParticipant.count({ where: { transactionId } });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function removedByBen() {
	const id = await dinner();
	const { value } = await forUser(ben.user.id).apply(removeSelfMutation, {
		transactionId: id,
		confirmBalanceChange: true,
	});
	return { id, value };
}

describe("remove-me undo", () => {
	it("puts the share back while the expense is as the removal left it", async () => {
		const { id, value } = await removedByBen();
		expect(await shares(id)).toBe(1);
		await forUser(ben.user.id).apply(restoreSelfMutation, {
			transactionId: id,
			removed: value.removed,
			expectedUpdatedAt: value.updatedAt,
		});
		expect(await shares(id)).toBe(2);
	});

	it("is refused after the expense was edited", async () => {
		const { id, value } = await removedByBen();
		await ana.db.sharedTransaction.update({
			where: { id },
			data: { description: "Dinner, edited" },
		});
		await expect(
			forUser(ben.user.id).apply(restoreSelfMutation, {
				transactionId: id,
				removed: value.removed,
				expectedUpdatedAt: value.updatedAt,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await shares(id)).toBe(1);
	});

	it("waits for an edit that is still running, then refuses", async () => {
		const { id, value } = await removedByBen();
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		let editing = () => {};
		const started = new Promise<void>((resolve) => {
			editing = resolve;
		});
		// The edit has changed the expense and not committed yet.
		const edit = ana.db.$transaction(async (tx) => {
			await tx.sharedTransaction.update({
				where: { id },
				data: { description: "Dinner, edited" },
			});
			editing();
			await hold;
		});
		await started;

		let done = false;
		const restore = forUser(ben.user.id)
			.apply(restoreSelfMutation, {
				transactionId: id,
				removed: value.removed,
				expectedUpdatedAt: value.updatedAt,
			})
			.then(
				() => "restored",
				(error: unknown) => error,
			)
			.finally(() => {
				done = true;
			});
		// Without the lock the undo reads the old stamp, matches and commits.
		await sleep(500);
		expect(done).toBe(false);

		release();
		await edit;
		const outcome = await restore;
		expect(outcome).toBeInstanceOf(TRPCError);
		expect((outcome as TRPCError).code).toBe("CONFLICT");
		expect(await shares(id)).toBe(1);
	});
});

describe("remove-me on corrections", () => {
	/** A correction of `originalId` that moves USD 10 from Ana's share to Ben's. */
	async function correctionOf(originalId: string) {
		const made = await adminDb.sharedTransaction.create({
			data: {
				description: "Correction",
				amount: "0",
				currency: "USD",
				date: new Date("2026-10-11"),
				splitMode: "EXACT",
				correctsId: originalId,
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user" as const,
							participantId: ana.user.id,
							shareAmount: "-10",
							verificationStatus: "ACCEPTED" as const,
						},
						{
							participantType: "user" as const,
							participantId: ben.user.id,
							shareAmount: "10",
							verificationStatus: "ACCEPTED" as const,
						},
					],
				},
			},
		});
		return made.id;
	}

	it("refuses on an expense that has corrections", async () => {
		const id = await dinner();
		await correctionOf(id);
		await expect(
			forUser(ben.user.id).apply(removeSelfMutation, {
				transactionId: id,
				confirmBalanceChange: true,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "This expense has corrections. Undo them first",
		});
		expect(await shares(id)).toBe(2);
	});

	it("refuses on a correction row", async () => {
		const correction = await correctionOf(await dinner());
		await expect(
			forUser(ben.user.id).apply(removeSelfMutation, {
				transactionId: correction,
				confirmBalanceChange: true,
			}),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "A correction cannot be edited. Undo it instead",
		});
		expect(await shares(correction)).toBe(2);
	});
});

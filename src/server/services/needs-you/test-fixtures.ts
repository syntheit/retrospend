/**
 * Seeds shared by needs-you.pg.test.ts and needs-you.perf.pg.test.ts.
 * Everything is in USD, so no rate is seeded.
 */
import { randomUUID } from "node:crypto";
import {
	addRow,
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";

export const DAY = 86_400_000;
/**
 * Splits fall today (noon UTC, the budget's UTC zone): inside the budget's
 * first month whatever the run date, never before its start.
 */
export const SPLIT_DAY = new Date(
	`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`,
);
export const ref = (id: string): ParticipantRef => ({
	participantType: "user",
	participantId: id,
});

export async function claim(
	payer: string,
	payee: string,
	status: "PROPOSED" | "CONFIRMED",
	recordedBy = payer,
) {
	return adminDb.payment.create({
		data: {
			id: randomUUID(),
			payerType: "user",
			payerId: payer,
			payeeType: "user",
			payeeId: payee,
			amount: "50",
			currency: "USD",
			paidOn: new Date("2026-10-18"),
			recordedByType: "user",
			recordedById: recordedBy,
			status,
		},
	});
}

/** `payer` paid and created it; `other` holds `share` with `status`. */
export function shared(
	title: string,
	payer: string,
	other: string,
	share: string,
	status: "PENDING" | "REJECTED" | "ACCEPTED",
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: title,
			amount: share,
			currency: "USD",
			date: SPLIT_DAY,
			paidByType: "user",
			paidById: payer,
			createdByType: "user",
			createdById: payer,
			splitParticipants: {
				create: [
					{ ...ref(other), shareAmount: share, verificationStatus: status },
					{ ...ref(payer), shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
}

export function recurring(
	userId: string,
	name: string,
	nextDueDate: Date,
	o: Partial<{ ask: boolean; isActive: boolean; dir: "IN" | "OUT" }> = {},
) {
	return adminDb.recurringTemplate.create({
		data: {
			userId,
			name,
			amount: "41500",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate,
			autoPay: false,
			amountMode: o.ask ? "ASK" : "FIXED",
			direction: o.dir ?? "OUT",
			isActive: o.isActive ?? true,
		},
	});
}

export function importJob(
	userId: string,
	status: "READY_FOR_REVIEW" | "REVIEWING" | "COMPLETED",
	rows: number,
	ready: Date,
) {
	return adminDb.importJob.create({
		data: {
			userId,
			status,
			type: "CSV",
			fileName: "statement.csv",
			fileSize: 100,
			fileType: "csv",
			totalTransactions: rows,
			readyForReviewAt: ready,
		},
	});
}

export async function seedBudget(s: Awaited<ReturnType<typeof seedUser>>) {
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	await addRow(s.user.id, { amount: 30, categoryId: s.dining });
}

export const now = new Date();
export const opts = { timeZone: "UTC", now } as const;

/** A user whose book holds three of each source, for the budget tests. */
export async function seedBusyUser() {
	const busy = await seedUser();
	const me = busy.user.id;
	for (let i = 0; i < 3; i++) {
		const other = await createTestUser();
		await claim(other.user.id, me, "PROPOSED");
		await shared(`Split ${i}`, other.user.id, me, "100", "PENDING");
		await shared(`Mine ${i}`, me, other.user.id, "200", "REJECTED");
		await recurring(me, `Bill ${i}`, new Date(now.getTime() - (i + 1) * DAY));
		await importJob(me, "READY_FOR_REVIEW", 5, new Date(now.getTime() - DAY));
	}
	await seedBudget(busy);
	return busy;
}

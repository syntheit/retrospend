/**
 * A correction dates its rows by the user's day, with no zone in the input,
 * on real Postgres. The instant 2026-11-03T02:00Z is Nov 3 in UTC but still
 * Nov 2, 23:00 in Buenos Aires (UTC-3). A correction without an input zone
 * reads the user's saved zone, never the server process's; an explicit zone
 * wins. ARS 20,000 split in two, corrected to 24,000.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser } from "~/server/services/envelope/__tests__/pg-fixture";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { correctSplitMutation } from "./correct.mutation";

const INSTANT = new Date("2026-11-03T02:00:00Z");
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
});

afterEach(() => {
	vi.useRealTimers();
});

async function correctionDate(timeZone?: string) {
	const sofia = await seedUser();
	const martin = await seedUser();
	await adminDb.user.update({
		where: { id: sofia.user.id },
		data: { homeCurrency: "ARS", timeZone: BUENOS_AIRES },
	});
	const original = await adminDb.sharedTransaction.create({
		data: {
			description: "Electricidad",
			amount: "20000",
			currency: "ARS",
			date: new Date("2026-10-20T12:00:00Z"),
			isLocked: true,
			categoryId: sofia.dining,
			paidByType: "user",
			paidById: sofia.user.id,
			createdByType: "user",
			createdById: sofia.user.id,
			splitParticipants: {
				create: [sofia, martin].map((u) => ({
					participantType: "user",
					participantId: u.user.id,
					shareAmount: "10000",
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
	const id = randomUUID();
	await forUser(sofia.user.id).apply(correctSplitMutation, {
		id,
		transactionId: original.id,
		description: "Correction to Electricidad",
		amount: "24000",
		paidBy: { type: "user", id: sofia.user.id },
		categoryId: sofia.dining,
		splitMode: "EQUAL",
		splitWith: [
			{ participant: { type: "user", id: sofia.user.id } },
			{ participant: { type: "user", id: martin.user.id } },
		],
		...(timeZone ? { timeZone } : {}),
	});
	const row = await adminDb.sharedTransaction.findUniqueOrThrow({
		where: { id },
	});
	// 4,000 more, 2,000 on each of the two.
	expect(row.amount.toString()).toBe("4000");
	return row.date;
}

describe("correct a settled split", () => {
	it("dates the correction on the saved zone's day: Nov 2, midnight in Buenos Aires", async () => {
		expect(await correctionDate()).toEqual(new Date("2026-11-02T03:00:00Z"));
	});

	it("dates the correction on the input zone's day when one is given", async () => {
		expect(await correctionDate("UTC")).toEqual(
			new Date("2026-11-03T00:00:00Z"),
		);
	});
});

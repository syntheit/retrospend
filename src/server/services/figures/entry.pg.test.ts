/**
 * The entry figures: what one Activity row shows, read by the row's id so
 * the web, the API and the e2e audit read the same number. By hand, ARS home:
 *
 * - Cafe, personal, USD 12.50: amount USD 1250 minor, no share.
 * - Dinner, shared, ARS 9,000.00 paid by Ben, split Ana 3,000.00 and Ben
 *   6,000.00: Ana's row amount ARS 900000 minor, her share ARS 300000.
 * - Ben's ARS 500.00 payment to Ana: the payment row's amount ARS 50000.
 * A person who is not on a row reads nothing of it (RLS); a payment between
 * two other members of a project Ana shares is not hers to read either.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { adminDb, createTestUser } from "~/test/pg-harness";

let ana: Awaited<ReturnType<typeof createTestUser>>;
let ben: Awaited<ReturnType<typeof createTestUser>>;
let cafe: string;
let dinner: string;
let payment: string;
let betweenOthers: string;

beforeAll(async () => {
	ana = await createTestUser();
	ben = await createTestUser();
	for (const u of [ana, ben])
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "ARS" },
		});
	const expense = await adminDb.expense.create({
		data: {
			userId: ana.user.id,
			title: "Cafe",
			amount: "12.50",
			currency: "USD",
			exchangeRate: "1",
			amountInUSD: "12.50",
			pricingSource: "MANUAL",
			date: new Date("2026-10-08T15:00:00Z"),
		},
	});
	cafe = expense.id;
	const tx = await adminDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount: "9000",
			currency: "ARS",
			date: new Date("2026-10-09T15:00:00Z"),
			paidByType: "user",
			paidById: ben.user.id,
			createdByType: "user",
			createdById: ben.user.id,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: ana.user.id,
						shareAmount: "3000",
						verificationStatus: "ACCEPTED",
					},
					{
						participantType: "user",
						participantId: ben.user.id,
						shareAmount: "6000",
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
	dinner = `shared:${tx.id}`;
	const paid = await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: ben.user.id,
			toParticipantType: "user",
			toParticipantId: ana.user.id,
			amount: "500",
			currency: "ARS",
			status: "FINALIZED",
		},
	});
	payment = `payment:${paid.id}|ARS`;
	// Ben pays Cam inside a project Ana is a member of: Ana can see the rows
	// (project members do) but is not a party to the payment.
	const cam = await createTestUser();
	const project = await adminDb.project.create({
		data: { name: "Trip", primaryCurrency: "ARS", createdById: ana.user.id },
	});
	for (const u of [ana, ben, cam])
		await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: u.user.id,
				role: "CONTRIBUTOR",
			},
		});
	const other = await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: ben.user.id,
			toParticipantType: "user",
			toParticipantId: cam.user.id,
			amount: "700",
			currency: "ARS",
			status: "FINALIZED",
			projectId: project.id,
		},
	});
	betweenOthers = `payment:${other.id}|ARS`;
});

const read = async (id: string, entryId: string, user = ana) =>
	(await readFigures(user.user.id, [id], { entryId })).get(id);

describe("figure entry.amount", () => {
	it("is the row's amount in its own currency, whatever kind of row", async () => {
		expect(await read("entry.amount", cafe)).toEqual([
			{ minor: 1250, currency: "USD" },
		]);
		expect(await read("entry.amount", dinner)).toEqual([
			{ minor: 900000, currency: "ARS" },
		]);
		expect(await read("entry.amount", payment)).toEqual([
			{ minor: 50000, currency: "ARS" },
		]);
	});

	it("reads nothing of a payment between two other people, as the list shows none", async () => {
		expect(await read("entry.amount", betweenOthers)).toEqual([]);
		expect(await read("entry.amount", betweenOthers, ben)).toEqual([
			{ minor: 70000, currency: "ARS" },
		]);
	});

	it("reads nothing of a row that is not yours, or that is not there", async () => {
		expect(await read("entry.amount", cafe, ben)).toEqual([]);
		expect(await read("entry.amount", "shared:nope")).toEqual([]);
	});
});

describe("figure entry.share", () => {
	it("is your share of a shared expense", async () => {
		expect(await read("entry.share", dinner)).toEqual([
			{ minor: 300000, currency: "ARS" },
		]);
		expect(await read("entry.share", dinner, ben)).toEqual([
			{ minor: 600000, currency: "ARS" },
		]);
	});

	it("is empty for a row with no share", async () => {
		expect(await read("entry.share", cafe)).toEqual([]);
		expect(await read("entry.share", payment)).toEqual([]);
	});
});

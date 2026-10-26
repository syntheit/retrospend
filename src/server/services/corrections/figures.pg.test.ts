/**
 * The correction figures, by hand. The bill "Electricidad" was ARS 45,000
 * paid by Ana, ARS 15,000 each for Ana, Ben and Cam. It was really 48,000:
 *
 *   correction 1: +3,000 paid by Ana, +1,000 on each of the three.
 *   correction 2: -900 paid by Ana (a refund), -300 on each.
 *
 * The figures are what the corrections changed (the original is never
 * rewritten), per person, in minor units of ARS: after both, Ana paid
 * 3,000 - 900 = 2,100 more (210000) and each share moved 1,000 - 300 = 700
 * (70000). Someone who paid nothing more reads zero; a split nobody
 * corrected reads nothing. Ben, who did not make the corrections, sees his
 * own share rows only (RLS), so he reads his 700 and nothing for Cam.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { adminDb, createTestUser } from "~/test/pg-harness";

type User = Awaited<ReturnType<typeof createTestUser>>;

let ana: User;
let ben: User;
let cam: User;
let original: string;
let untouched: string;

const who = (u: User) => ({
	participantType: "user" as const,
	participantId: u.user.id,
});
const key = (u: User) => `user:${u.user.id}`;

async function expense(
	creator: User,
	amount: string,
	shares: [User, string][],
	correctsId: string | null,
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Electricidad",
			amount,
			currency: "ARS",
			date: new Date("2026-10-08T15:00:00Z"),
			paidByType: "user",
			paidById: creator.user.id,
			createdByType: "user",
			createdById: creator.user.id,
			correctsId,
			splitParticipants: {
				create: shares.map(([u, shareAmount]) => ({
					...who(u),
					shareAmount,
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
}

beforeAll(async () => {
	[ana, ben, cam] = [
		await createTestUser(),
		await createTestUser(),
		await createTestUser(),
	];
	const all = (n: string): [User, string][] => [
		[ana, n],
		[ben, n],
		[cam, n],
	];
	original = (await expense(ana, "45000", all("15000"), null)).id;
	await expense(ana, "3000", all("1000"), original);
	await expense(ana, "-900", all("-300"), original);
	untouched = (await expense(ana, "100", all("33.33"), null)).id;
});

const read = async (
	id: string,
	user: User,
	transactionId: string,
	person: User,
) =>
	(
		await readFigures(user.user.id, [id], {
			transactionId,
			personId: key(person),
		})
	).get(id);

const ars = (minor: number) => ({ minor, currency: "ARS" });

describe("figure correction.paid", () => {
	it("is what the payer paid more or less, after every correction", async () => {
		expect(await read("correction.paid", ana, original, ana)).toEqual([
			ars(210000),
		]);
	});

	it("reads zero for someone who paid nothing on the corrections", async () => {
		expect(await read("correction.paid", ana, original, ben)).toEqual([ars(0)]);
	});

	it("reads nothing for a split nobody corrected", async () => {
		expect(await read("correction.paid", ana, untouched, ana)).toEqual([]);
	});
});

describe("figure correction.share", () => {
	it("is how far each person's share moved", async () => {
		for (const u of [ana, ben, cam])
			expect(await read("correction.share", ana, original, u)).toEqual([
				ars(70000),
			]);
	});

	it("shows a participant only the rows they can see", async () => {
		expect(await read("correction.share", ben, original, ben)).toEqual([
			ars(70000),
		]);
		expect(await read("correction.share", ben, original, cam)).toEqual([
			ars(0),
		]);
	});

	it("reads nothing for a split nobody corrected", async () => {
		expect(await read("correction.share", ana, untouched, ben)).toEqual([]);
	});
});

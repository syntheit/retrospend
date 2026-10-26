/**
 * What a debtor can learn about who else is on their expenses, on a real
 * Postgres through RLS. Outside a project a debtor sees only their own split
 * row, so a plain read of the table finds no other person. The two helpers
 * (shares_expense_with, co_participant_counts) answer a yes and a count and
 * leave the policy, and every amount and note, where they were.
 *
 * Ana paid two standalone expenses; Ben and Cam owe her:
 *   Dinner  ARS 900 paid by Ana:  Ana 300, Ben 300, Cam 300
 *   Taxi    ARS 400 paid by Ana:  Ana 200, Ben 200
 * Ben is on both (Ana twice, Cam once); Dan, a stranger, is on neither.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { paymentMethodRouter } from "~/server/api/routers/paymentMethod";
import { createCallerFactory } from "~/server/api/trpc";
import { frequentSplitPartners } from "~/server/services/people/frequent-partners";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { coParticipantCounts, sharesExpenseWith } from "../co-participants";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let ana: TestUser;
let ben: TestUser;
let cam: TestUser;
let dan: TestUser;
let samId: string;

const user = (u: TestUser) => ({
	participantType: "user" as const,
	participantId: u.user.id,
});

async function name(u: TestUser, label: string) {
	await adminDb.user.update({
		where: { id: u.user.id },
		data: { name: label },
	});
}

beforeAll(async () => {
	[ana, ben, cam, dan] = await Promise.all([
		createTestUser(),
		createTestUser(),
		createTestUser(),
		createTestUser(),
	]);
	await Promise.all([
		name(ana, "Ana"),
		name(ben, "Ben"),
		name(cam, "Cam"),
		name(dan, "Dan"),
	]);
	const sam = await adminDb.shadowProfile.create({
		data: { createdById: ana.user.id, name: "Sam" },
	});
	samId = sam.id;

	const expense = (
		description: string,
		amount: string,
		splits: Array<[TestUser | "sam", string]>,
	) =>
		adminDb.sharedTransaction.create({
			data: {
				description,
				amount,
				currency: "ARS",
				date: new Date("2026-10-05T12:00:00Z"),
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				splitParticipants: {
					create: splits.map(([who, share]) => ({
						participantType:
							who === "sam" ? ("shadow" as const) : ("user" as const),
						participantId: who === "sam" ? samId : who.user.id,
						shareAmount: share,
						verificationStatus: "ACCEPTED" as const,
					})),
				},
			},
		});
	await expense("Dinner", "900", [
		[ana, "300"],
		[ben, "300"],
		[cam, "300"],
	]);
	await expense("Taxi", "400", [
		[ana, "200"],
		[ben, "200"],
	]);
	await expense("Kiosk", "30", [
		[ana, "10"],
		["sam", "20"],
	]);
});

describe("a debtor outside a project", () => {
	it("still sees only their own split rows (the policy is unchanged)", async () => {
		const rows = await ben.db.splitParticipant.findMany({
			select: { participantId: true, shareAmount: true },
		});
		expect(rows.map((r) => r.participantId)).toEqual([
			ben.user.id,
			ben.user.id,
		]);
		// The old relationship read, as the payment-method match made it: empty.
		const old = await ben.db.splitParticipant.findFirst({
			where: {
				participantType: "user",
				participantId: ben.user.id,
				transaction: {
					splitParticipants: {
						some: { participantType: "user", participantId: ana.user.id },
					},
				},
			},
		});
		expect(old).toBeNull();
	});

	it("learns that they share an expense with the payer and with the other debtor, and with no one else", async () => {
		expect(await sharesExpenseWith(ben.db, user(ana))).toBe(true);
		expect(await sharesExpenseWith(ben.db, user(cam))).toBe(true);
		expect(await sharesExpenseWith(ben.db, user(dan))).toBe(false);
	});

	it("counts the people they split with, most shared first, without any amount", async () => {
		const counts = await coParticipantCounts(ben.db, 10);
		expect(counts).toEqual([
			{ participantType: "user", participantId: ana.user.id, sharedCount: 2 },
			{ participantType: "user", participantId: cam.user.id, sharedCount: 1 },
		]);
		for (const row of counts) {
			expect(Object.keys(row).sort()).toEqual([
				"participantId",
				"participantType",
				"sharedCount",
			]);
		}
		expect(await coParticipantCounts(ben.db, 1)).toHaveLength(1);
	});

	it("answers only for the signed-in user, never for two other people", async () => {
		// Dan is on nothing: the pair (Ana, Ben) is invisible to him.
		expect(await sharesExpenseWith(dan.db, user(ana))).toBe(false);
		expect(await sharesExpenseWith(dan.db, user(ben))).toBe(false);
		expect(await coParticipantCounts(dan.db, 10)).toEqual([]);
	});

	it("gets their frequent partners: the payer and the other debtor", async () => {
		const partners = await frequentSplitPartners(ben.db, ben.user.id);
		expect(partners.map((p) => [p.name, p.participantType])).toEqual([
			["Ana", "user"],
			["Cam", "user"],
		]);
	});

	it("does not get someone else's ghost as a quick pick", async () => {
		// Ana's ghost Sam is on Kiosk with Ana only; Ben is not on it. Ana, who
		// made Sam, gets Sam; Cam, who shares no expense with Sam, does not.
		const anas = await frequentSplitPartners(ana.db, ana.user.id);
		expect(anas.map((p) => p.name)).toContain("Sam");
		const cams = await frequentSplitPartners(cam.db, cam.user.id);
		expect(cams.map((p) => p.name)).not.toContain("Sam");
	});
});

describe("payment methods for a debtor", () => {
	const caller = (u: TestUser) =>
		createCallerFactory(paymentMethodRouter)({
			db: adminDb,
			session: {
				user: {
					id: u.user.id,
					role: u.user.role,
					email: u.user.email,
					name: u.user.name,
					isActive: true,
				},
			} as never,
			headers: new Headers(),
		});

	beforeAll(async () => {
		const method = (u: TestUser, visibility: "PUBLIC" | "FRIENDS_ONLY") => ({
			userId: u.user.id,
			type: "bank",
			label: `${visibility} bank`,
			identifier: `acct-${u.user.id.slice(0, 6)}-${visibility}`,
			rank: visibility === "PUBLIC" ? 1 : 2,
			visibility,
		});
		await adminDb.paymentMethod.createMany({
			data: [
				method(ben, "PUBLIC"),
				method(ana, "PUBLIC"),
				method(ana, "FRIENDS_ONLY"),
			],
		});
	});

	it("sees the payer's private method once they share an expense", async () => {
		const out = await caller(ben).match(user(ana));
		expect(out.theirMethods.map((m) => m.visibility).sort()).toEqual([
			"FRIENDS_ONLY",
			"PUBLIC",
		]);
	});

	it("sees only the public one without a shared expense", async () => {
		const out = await caller(dan).match(user(ana));
		expect(out.theirMethods.map((m) => m.visibility)).toEqual(["PUBLIC"]);
	});
});

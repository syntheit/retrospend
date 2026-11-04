/**
 * Which day payment.record dates a payment with no zone in the input, on real
 * Postgres. The instant 2026-11-03T02:00Z is Nov 3 in UTC and Tokyo (11:00)
 * but still Nov 2, 23:00 in Buenos Aires (UTC-3). A payment without an input
 * zone is dated in the user's zone (userTimeZone), never the server process's.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { forUser } from "~/server/services/preview";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { squareUpProjects } from "~/server/services/shared-expenses/settlement-square-up";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { type RecordPaymentInput, recordPayment } from "./record.mutation";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const INSTANT = new Date("2026-11-03T02:00:00Z");
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});

let creditor: TestUser;

/** A payer, ARS home, who owes `creditor` the given share and has the given stored zone. */
async function payerWith(
	timeZone: string | null,
	share = { amount: "18000", currency: "ARS" },
) {
	const payer = await createTestUser();
	await adminDb.user.update({
		where: { id: payer.user.id },
		data: { homeCurrency: "ARS", timeZone },
	});
	await adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			...share,
			date: new Date("2026-10-08"),
			paidByType: "user",
			paidById: creditor.user.id,
			createdByType: "user",
			createdById: creditor.user.id,
			splitParticipants: {
				create: [
					{
						...ref(payer),
						shareAmount: share.amount,
						verificationStatus: "ACCEPTED",
					},
					{
						...ref(creditor),
						shareAmount: "0",
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
	return payer;
}

const pay = (
	amount: string | null,
	timeZone?: string,
): RecordPaymentInput => ({
	person: ref(creditor),
	direction: "outgoing",
	currency: "ARS",
	amount,
	...(timeZone ? { timeZone } : {}),
});

async function paidOnOf(paymentId: string) {
	const row = await adminDb.payment.findUniqueOrThrow({
		where: { id: paymentId },
		select: { paidOn: true },
	});
	return row.paidOn.toISOString().slice(0, 10);
}

/** Records the payment and returns the day it was dated. */
async function recordedDay(payer: TestUser, timeZone?: string) {
	const { value } = await forUser(payer.user.id).apply(
		recordPayment,
		pay("18000", timeZone),
	);
	if (!value.recorded) throw new Error("not recorded");
	return paidOnOf(value.paymentId);
}

beforeAll(async () => {
	creditor = await createTestUser();
	// Blue rates per USD on two days: BRL 1 = ARS 200 on Nov 2, ARS 400 on Nov 3.
	for (const [date, currency, rate] of [
		["2026-11-02", "ARS", "1000"],
		["2026-11-02", "BRL", "5"],
		["2026-11-03", "ARS", "2000"],
		["2026-11-03", "BRL", "5"],
	] as const) {
		await adminDb.exchangeRate.create({
			data: { date: new Date(date), currency, type: "blue", rate },
		});
	}
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("payment.record dates a payment with no zone in the input", () => {
	it("uses the user's saved zone: Nov 2 in Buenos Aires while UTC is Nov 3", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		const payer = await payerWith(BUENOS_AIRES);
		expect(await recordedDay(payer)).toBe("2026-11-02");
	});

	it("lets an explicit zone in the input win over the saved one", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		const payer = await payerWith(BUENOS_AIRES);
		expect(await recordedDay(payer, "Asia/Tokyo")).toBe("2026-11-03");
	});

	it("uses the server default zone for a user with no saved zone", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		vi.stubEnv("DEFAULT_TIME_ZONE", "Asia/Tokyo");
		expect(await recordedDay(await payerWith(null))).toBe("2026-11-03");
		vi.stubEnv("DEFAULT_TIME_ZONE", BUENOS_AIRES);
		expect(await recordedDay(await payerWith(null))).toBe("2026-11-02");
	});

	it("keeps a paidOn the client sent, whatever the zones", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		const payer = await payerWith(BUENOS_AIRES);
		const { value } = await forUser(payer.user.id).apply(recordPayment, {
			...pay("18000"),
			paidOn: "2026-10-30",
		});
		if (!value.recorded) throw new Error("not recorded");
		expect(await paidOnOf(value.paymentId)).toBe("2026-10-30");
	});

	it("previews the same day it records: the rate day sets the converted amount", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		// Owes BRL 100. On Nov 2 that is ARS 20,000 (x200); on Nov 3, ARS 40,000.
		const payer = await payerWith(BUENOS_AIRES, {
			amount: "100",
			currency: "BRL",
		});
		const runner = forUser(payer.user.id);
		const previewed = await runner.preview(recordPayment, pay(null));
		const applied = await runner.apply(recordPayment, pay(null));
		for (const result of [previewed, applied]) {
			if (!result.value.recorded) throw new Error("not recorded");
			expect(result.value.allocation?.amount).toEqual({
				minor: 2_000_000,
				currency: "ARS",
			});
		}
		if (!applied.value.recorded) throw new Error("not recorded");
		expect(await paidOnOf(applied.value.paymentId)).toBe("2026-11-02");
	});
});

describe("square up", () => {
	/** Ann paid ARS 100 in Trip that Bob owes; Bob paid ARS 100 in Rent that Ann owes. */
	async function pairWithProjectBalances(annZone: string | null) {
		const ann = await createTestUser();
		await adminDb.user.update({
			where: { id: ann.user.id },
			data: { homeCurrency: "ARS", timeZone: annZone },
		});
		const bob = creditor;
		const project = async (owner: TestUser, other: TestUser) => {
			const { id } = await adminDb.project.create({
				data: {
					name: "P",
					createdById: owner.user.id,
					primaryCurrency: "ARS",
				},
			});
			for (const u of [owner, other]) {
				await adminDb.projectParticipant.create({
					data: { projectId: id, ...ref(u), role: "EDITOR" },
				});
			}
			return id;
		};
		const share = async (
			payer: TestUser,
			debtor: TestUser,
			projectId: string,
		) =>
			adminDb.sharedTransaction.create({
				data: {
					description: "Shared",
					amount: "100",
					currency: "ARS",
					date: new Date("2026-10-08"),
					paidByType: "user",
					paidById: payer.user.id,
					createdByType: "user",
					createdById: payer.user.id,
					projectId,
					splitParticipants: {
						create: [
							{
								...ref(debtor),
								shareAmount: "100",
								verificationStatus: "ACCEPTED",
							},
							{
								...ref(payer),
								shareAmount: "0",
								verificationStatus: "ACCEPTED",
							},
						],
					},
				},
			});
		await share(ann, bob, await project(ann, bob));
		await share(bob, ann, await project(bob, ann));
		return { ann, bob };
	}

	const squaredDay = async (annZone: string | null, timeZone?: string) => {
		const { ann, bob } = await pairWithProjectBalances(annZone);
		const done = await squareUpProjects(adminDb, ref(ann), {
			toParticipant: ref(bob),
			currency: "ARS",
			...(timeZone ? { timeZone } : {}),
		});
		return paidOnOf(done.paymentGroupId);
	};

	it("dates the offset on the saved zone's day: Nov 2 in Buenos Aires", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		expect(await squaredDay(BUENOS_AIRES)).toBe("2026-11-02");
	});

	it("lets an explicit zone win", async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: INSTANT });
		expect(await squaredDay(BUENOS_AIRES, "Asia/Tokyo")).toBe("2026-11-03");
	});
});

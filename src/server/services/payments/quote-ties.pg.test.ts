/**
 * A quote with a non-terminating cross rate, on real Postgres: NOK at 9 per
 * USD into a JPY home at 16.5 is 16.5 / 9 JPY per NOK (1.8333...3). Taro owes
 * Mia NOK 3.00, which is 3 x 16.5 / 9 = 5.5 JPY, a tie that half even takes
 * to 6 (5 is odd). Multiplying by the 40-digit quotient gave 5.4999...9 and 5.
 * The People page, the owed figure, the settle-up preview and the recorded
 * payment must all say JPY 6.
 */
import { dayKey } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it } from "vitest";
import { personPage } from "~/server/services/people/detail";
import { peopleOverview } from "~/server/services/people/overview";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { applyPayment, previewPayment } from "./procedures";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
const ref = (u: TestUser): ParticipantRef => ({
	participantType: "user",
	participantId: u.user.id,
});
const jpy = (minor: number) => ({ minor, currency: "JPY" });

let taro: TestUser;
let mia: TestUser;

beforeAll(async () => {
	for (const [currency, rate] of [
		["NOK", "9"],
		["JPY", "16.5"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: {
				date_currency_type: { date: today, currency, type: "official" },
			},
			create: { date: today, currency, type: "official", rate },
			update: { rate },
		});
	}
	taro = await createTestUser();
	mia = await createTestUser();
	for (const u of [taro, mia]) {
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "JPY" },
		});
	}
	await adminDb.sharedTransaction.create({
		data: {
			description: "Fika",
			amount: "3",
			currency: "NOK",
			date: new Date("2026-10-08"),
			paidByType: "user",
			paidById: mia.user.id,
			createdByType: "user",
			createdById: mia.user.id,
			splitParticipants: {
				create: [
					{ ...ref(taro), shareAmount: "3", verificationStatus: "ACCEPTED" },
					{ ...ref(mia), shareAmount: "0", verificationStatus: "ACCEPTED" },
				],
			},
		},
	});
});

describe("NOK 3.00 at 16.5 / 9 JPY per NOK", () => {
	it("is JPY 6 on the People page and in You owe", async () => {
		const view = await peopleOverview(taro.db, taro.user.id);
		expect(view.youOwe).toEqual(jpy(6));
		expect(view.owedToYou).toEqual(jpy(0));
		const part = view.people[0]?.parts[0];
		expect(part?.amount).toEqual({ minor: -300, currency: "NOK" });
		expect(part?.home).toEqual(jpy(-6));
	});

	it("is JPY 6 on the Person page", async () => {
		const page = await personPage(taro.db, taro.user.id, ref(mia));
		expect(page.parts[0]?.home).toEqual(jpy(-6));
		expect(page.net).toEqual(jpy(-6));
	});

	it("settle up: Everything is JPY 6, the preview equals the recorded payment, and it clears the debt", async () => {
		const input = {
			person: ref(mia),
			direction: "outgoing" as const,
			currency: "JPY",
			amount: "6",
		};
		const preview = await previewPayment(taro.user.id, input);
		expect(preview.value.recorded).toBe(true);
		expect(
			preview.value.allocation?.rows.map((r) => [
				r.pays.minor,
				r.pays.currency,
				r.paid.minor,
			]),
		).toEqual([[300, "NOK", 6]]);
		expect(preview.value.allocation?.overpay).toBeNull();
		expect(
			preview.changes.map((c) => [
				c.id,
				c.currency,
				c.before?.minor ?? null,
				c.after?.minor ?? null,
			]),
		).toEqual([
			["balance.person", "NOK", -300, null],
			["owed.youOwe", "JPY", 6, 0],
		]);
		const applied = await applyPayment(taro.db, taro.user.id, input);
		expect(applied.changes).toEqual(preview.changes);
		const view = await peopleOverview(taro.db, taro.user.id);
		expect(view.youOwe).toEqual(jpy(0));
	});
});

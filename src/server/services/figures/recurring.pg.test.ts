/**
 * The recurring figures, by hand. NOK home (a currency no other pg file
 * prices), NOK 10 per USD:
 *
 * - Gym NOK 620 monthly, Netflix USD 12.99 monthly (NOK 129.90 at home),
 *   Club NOK 300 weekly (300 x 52 / 12 = 1,300 a month): out costs NOK
 *   2,049.90 a month, 6,149.70 a quarter, 24,598.80 a year.
 * - A paused template and one in a currency with no rate stay out of the
 *   cost: the rate-less one is named by recurring.listView, never counted
 *   as zero or as 1 (R14).
 * - Salary NOK 5,000 monthly in: 5,000 a month, 15,000 a quarter, 60,000 a year.
 * Someone with no template that brings money in has no "in" cost at all.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { adminDb, createTestUser } from "~/test/pg-harness";

const nok = (minor: number) => ({ minor, currency: "NOK" });

let me: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
	me = await createTestUser();
	other = await createTestUser();
	for (const u of [me, other])
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { homeCurrency: "NOK" },
		});
	const date = new Date("2026-10-02T00:00:00Z");
	await adminDb.exchangeRate.upsert({
		where: { date_currency_type: { date, currency: "NOK", type: "official" } },
		create: { date, currency: "NOK", type: "official", rate: "10" },
		update: { rate: "10" },
	});
	const next = new Date("2026-11-01T00:00:00Z");
	const t = (
		id: string,
		name: string,
		amount: string,
		currency: string,
		frequency: "MONTHLY" | "WEEKLY" | "YEARLY",
		extra: object = {},
	) => ({
		id,
		userId: me.user.id,
		name,
		amount,
		currency,
		frequency,
		nextDueDate: next,
		autoPay: false,
		...extra,
	});
	await adminDb.recurringTemplate.createMany({
		data: [
			t("rf_gym", "Gym", "620", "NOK", "MONTHLY"),
			t("rf_netflix", "Netflix", "12.99", "USD", "MONTHLY"),
			t("rf_club", "Club", "300", "NOK", "WEEKLY"),
			t("rf_paused", "Paused", "1000", "NOK", "YEARLY", { isActive: false }),
			t("rf_xyz", "Token", "10", "XYZ", "MONTHLY"),
			t("rf_salary", "Salary", "5000", "NOK", "MONTHLY", { direction: "IN" }),
		],
	});
});

const read = async (id: string, narrowing = {}, user = me) =>
	(await readFigures(user.user.id, [id], narrowing)).get(id);

describe("figure recurring.amount", () => {
	it("is the template's amount in its own currency", async () => {
		expect(await read("recurring.amount", { recurringId: "rf_gym" })).toEqual([
			nok(62000),
		]);
		expect(
			await read("recurring.amount", { recurringId: "rf_netflix" }),
		).toEqual([{ minor: 1299, currency: "USD" }]);
	});

	it("reads nothing of someone else's template or an unknown one", async () => {
		expect(
			await read("recurring.amount", { recurringId: "rf_gym" }, other),
		).toEqual([]);
		expect(await read("recurring.amount", { recurringId: "nope" })).toEqual([]);
	});
});

describe("figure recurring.cost.out.month", () => {
	it("adds the active templates at today's rates, leaving the rate-less one out", async () => {
		expect(await read("recurring.cost.out.month")).toEqual([nok(204990)]);
	});
});

describe("figure recurring.cost.out.quarter", () => {
	it("is three months of it", async () => {
		expect(await read("recurring.cost.out.quarter")).toEqual([nok(614970)]);
	});
});

describe("figure recurring.cost.out.year", () => {
	it("is twelve months of it", async () => {
		expect(await read("recurring.cost.out.year")).toEqual([nok(2459880)]);
	});
});

describe("figure recurring.cost.in.month", () => {
	it("is what the active templates bring in", async () => {
		expect(await read("recurring.cost.in.month")).toEqual([nok(500000)]);
	});

	it("is empty when nothing brings money in", async () => {
		expect(await read("recurring.cost.in.month", {}, other)).toEqual([]);
	});
});

describe("figure recurring.cost.in.quarter", () => {
	it("is three months of it", async () => {
		expect(await read("recurring.cost.in.quarter")).toEqual([nok(1500000)]);
	});
});

describe("figure recurring.cost.in.year", () => {
	it("is twelve months of it", async () => {
		expect(await read("recurring.cost.in.year")).toEqual([nok(6000000)]);
	});
});

/**
 * A2 on Postgres: a Limits user who never records income (SPEC §5.6, 05
 * A2). USD book this month, cents. Expected values by hand:
 *
 *   setup: Dining limit 200.00, Groceries 420.00, Everything else none.
 *   The month is funded at setup: PLAN_FUND 20,000 + 42,000; hidden To
 *   assign -62,000; Left in your limits 62,000; no Needs you pool item.
 *   Dining spends 150.00: Left in your limits 47,000.
 *   "Only this month" Dining 250.00: PLAN_FUND +5,000, Dining Left 10,000,
 *   its target stays 200.00. "From now on" Groceries 400.00: PLAN_FUND
 *   -2,000, target 400.00.
 *   Next month: Dining's 10,000 and Groceries' 40,000 return (leftovers
 *   Return); the month funds 20,000 and 40,000, so Dining starts at 200.00,
 *   not 300.00. To assign = -65,000 - 60,000 + 50,000 = -75,000; with
 *   Σ Left 60,000 the budget holds -15,000 = 0 money in - 15,000 spent.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { addRow, invariantAt, seedUser } from "./__tests__/pg-fixture";
import { revertLimitMutation, setLimitMutation } from "./book.mutation";
import { addMonths } from "./calendar";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
const next = addMonths(current, 1);
const nextNoon = new Date(
	Date.UTC(Math.floor(next / 100), (next % 100) - 1, 1, 12),
);

function limitsInput(c: { rent: string; dining: string }): SetupInput {
	return {
		style: "LIMITS",
		groups: [{ key: "limits", name: "Limits", role: "SPENDING" }],
		envelopes: [
			{
				key: "dining",
				name: "Dining",
				groupKey: "limits",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [c.dining],
				target: {
					kind: "MONTHLY",
					amountMinor: 20_000,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			},
			{
				key: "groceries",
				name: "Groceries",
				groupKey: "limits",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [c.rent],
				target: {
					kind: "MONTHLY",
					amountMinor: 42_000,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			},
			{
				key: "else",
				name: "Everything else",
				groupKey: "limits",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
		],
	};
}

const row = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);

describe("A2 a Limits user on Postgres", () => {
	let s: Awaited<ReturnType<typeof seedUser>>;
	let ids: Record<string, string>;

	beforeAll(async () => {
		s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...limitsInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
			include: { envelopes: true },
		});
		ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
		expect(book).toMatchObject({ style: "LIMITS", fundingSource: "TARGETS" });
		expect(book.envelopes.every((e) => e.leftoverRule === "RETURN")).toBe(true);
	});

	it("setup funds the month: To assign -62,000 stays hidden, 62,000 left in your limits", async () => {
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(-62_000);
		expect(m?.verdict.lead).toMatchObject({
			kind: "LEFT_IN_LIMITS",
			amount: usd(62_000),
		});
		expect(m?.verdict.notice).toBeNull();
		expect(row(m, ids.Dining as string)?.assigned.minor).toBe(20_000);
		await expect(
			adminDb.budgetMovement.count({
				where: { kind: "PLAN_FUND", book: { createdById: s.user.id } },
			}),
		).resolves.toBe(2);
	});

	it("spending 150.00 leaves 47,000 in your limits", async () => {
		await addRow(s.user.id, { amount: 150, categoryId: s.dining });
		const m = await getMonth(s.user.id);
		expect(m?.verdict.lead.amount.minor).toBe(47_000);
		expect(m?.verdict.limits).toEqual({
			limit: usd(62_000),
			spent: usd(15_000),
		});
	});

	it("Only this month: Dining to 250.00 writes +5,000 and keeps the 200.00 target; the preview writes nothing", async () => {
		const input = {
			id: randomUUID(),
			envelopeId: ids.Dining as string,
			amountMinor: 25_000,
			scope: "THIS_MONTH" as const,
		};
		const before = await adminDb.budgetMovement.count();
		const p = await forUser(s.user.id).preview(setLimitMutation, input);
		expect(p.value.previous).toEqual(usd(20_000));
		await expect(adminDb.budgetMovement.count()).resolves.toBe(before);
		const r = await forUser(s.user.id).apply(setLimitMutation, input);
		expect(r.value.envelopes).toEqual([
			{ id: ids.Dining, before: usd(5_000), after: usd(10_000) },
		]);
		expect(r.undo).toMatchObject({ kind: "mirror", mutation: "envelope.undo" });
		const env = await adminDb.envelope.findUniqueOrThrow({
			where: { id: ids.Dining },
		});
		expect(env.targetAmount?.toString()).toBe("200");
		// A retry with the same id writes nothing more.
		await forUser(s.user.id).apply(setLimitMutation, input);
		await expect(adminDb.budgetMovement.count()).resolves.toBe(before + 1);
	});

	it("From now on: Groceries to 400.00 writes -2,000 and stores the new target", async () => {
		const r = await forUser(s.user.id).apply(setLimitMutation, {
			id: randomUUID(),
			envelopeId: ids.Groceries as string,
			amountMinor: 40_000,
			scope: "FROM_NOW_ON",
		});
		expect(r.value.previousTarget).toMatchObject({ targetAmount: "420" });
		expect(r.value.toAssign).toEqual({
			before: usd(-67_000),
			after: usd(-65_000),
		});
		const env = await adminDb.envelope.findUniqueOrThrow({
			where: { id: ids.Groceries },
		});
		expect(env.targetAmount?.toString()).toBe("400");
	});

	it("next month starts at each limit again: Dining 200.00, Groceries 400.00, To assign -75,000", async () => {
		const m = await getMonth(s.user.id, undefined, nextNoon);
		expect(row(m, ids.Dining as string)?.left.minor).toBe(20_000);
		expect(row(m, ids.Groceries as string)?.left.minor).toBe(40_000);
		expect(m?.toAssign.amount.minor).toBe(-75_000);
		expect(m?.toAssign.terms.returned.minor).toBe(50_000);
		await expect(invariantAt(s.user.id, nextNoon)).resolves.toEqual({
			budget: -15_000,
			ledger: -15_000,
		});
	});

	it("an Every dollar book cannot set limits", async () => {
		const other = await seedUser();
		await forUser(other.user.id).apply(setupEnvelopeBook, {
			...limitsInput(other),
			style: "FLEX",
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		const env = await adminDb.envelope.findFirstOrThrow({
			where: { book: { createdById: other.user.id }, name: "Dining" },
		});
		await expect(
			forUser(other.user.id).apply(setLimitMutation, {
				id: randomUUID(),
				envelopeId: env.id,
				amountMinor: 1,
				scope: "THIS_MONTH",
			}),
		).rejects.toThrow("Limits budget");
	});
});

describe("From now on and its undo put the target back exactly (findings 4 and 6)", () => {
	async function limitsUser() {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...limitsInput(s),
			timeZone: "UTC",
		});
		const env = await adminDb.envelope.findFirstOrThrow({
			where: { book: { createdById: s.user.id }, name: "Dining" },
		});
		return { s, env };
	}
	const snapshot = (e: Awaited<ReturnType<typeof limitsUser>>["env"]) => ({
		kind: e.kind,
		targetAmount: e.targetAmount?.toString() ?? null,
		targetCurrency: e.targetCurrency,
		targetMode: e.targetMode,
		targetCadence: e.targetCadence,
		targetStartMonth: e.targetStartMonth,
	});

	it("a weekly Refill target survives a From now on and its undo; funding returns to 20,000", async () => {
		const { s, env } = await limitsUser();
		const before = await adminDb.envelope.update({
			where: { id: env.id },
			data: {
				targetMode: "REFILL",
				targetCadence: "WEEK",
				targetAmount: 50,
			},
		});
		const r = await forUser(s.user.id).apply(setLimitMutation, {
			id: randomUUID(),
			envelopeId: env.id,
			amountMinor: 25_000,
			scope: "FROM_NOW_ON",
		});
		expect(r.value.previousTarget).toMatchObject({
			targetMode: "REFILL",
			targetCadence: "WEEK",
			targetAmount: "50",
		});
		expect(r.value.previous).toEqual(usd(20_000));
		await forUser(s.user.id).apply(revertLimitMutation, {
			id: randomUUID(),
			envelopeId: env.id,
		});
		const after = await adminDb.envelope.findUniqueOrThrow({
			where: { id: env.id },
		});
		expect(snapshot(after)).toEqual(snapshot(before));
		const m = await getMonth(s.user.id);
		expect(row(m, env.id)?.assigned.minor).toBe(20_000);
	});

	it("GEL 200 from now on stays GEL 200: this month funds its value today (200 / 0.9 = 222.22)", async () => {
		const { s, env } = await limitsUser();
		await adminDb.exchangeRate.deleteMany({
			where: { currency: "GEL", type: "official" },
		});
		await adminDb.exchangeRate.create({
			data: {
				date: new Date(Date.UTC(2020, 0, 1)),
				currency: "GEL",
				type: "official",
				rate: 0.9,
			},
		});
		const r = await forUser(s.user.id).apply(setLimitMutation, {
			id: randomUUID(),
			envelopeId: env.id,
			amountMinor: 20_000,
			currency: "GEL",
			scope: "FROM_NOW_ON",
		});
		expect(r.value.limit).toEqual({ minor: 20_000, currency: "GEL" });
		expect(r.value.limitInBook).toEqual(usd(22_222));
		expect(r.value.envelopes).toEqual([
			{ id: env.id, before: usd(20_000), after: usd(22_222) },
		]);
		const stored = await adminDb.envelope.findUniqueOrThrow({
			where: { id: env.id },
		});
		expect(stored.targetCurrency).toBe("GEL");
		expect(stored.targetAmount?.toString()).toBe("200");
		await forUser(s.user.id).apply(revertLimitMutation, {
			id: randomUUID(),
			envelopeId: env.id,
		});
		const back = await adminDb.envelope.findUniqueOrThrow({
			where: { id: env.id },
		});
		expect(back.targetCurrency).toBeNull();
		expect(back.targetAmount?.toString()).toBe("200");
	});
});

describe("figure budget.leftInLimits", () => {
	it("is Left in your limits in a Limits book and null in any other", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...limitsInput(s),
			timeZone: "UTC",
		});
		const r = await readFigures(s.user.id, ["budget.leftInLimits"]);
		expect(r.get("budget.leftInLimits")).toEqual([usd(62_000)]);
		const flex = await seedUser();
		await forUser(flex.user.id).apply(setupEnvelopeBook, {
			...limitsInput(flex),
			style: "FLEX",
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		const f = await readFigures(flex.user.id, ["budget.leftInLimits"]);
		expect(f.get("budget.leftInLimits")).toBeNull();
	});
});

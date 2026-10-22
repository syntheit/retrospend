/**
 * getMonth on a 3-year book (SPEC §5.13, build plan 02 §5.3): 36 months,
 * 5,000 expenses (a tenth in USD, valued at the book's blue rate), monthly
 * salary, 15 envelopes assigned every month. P2 has no checkpoints, so this
 * is the full pass. Target p95 under 250 ms on harbor; the measured numbers
 * are printed for the report.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";

const EXPENSES = 5_000;
const MONTHS = 36;
const ENVELOPES = 15;

async function seedThreeYears() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "ARS" },
	});
	const today = isoDateIn(new Date(), "UTC");
	const current = budgetMonthOf(today, [{ fromMonth: 0, startDay: 1 }]);
	const start = addMonths(current, -(MONTHS - 1));
	const monthDate = (m: number, day: number) =>
		new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, day, 12));
	const startDate = monthDate(start, 1);
	startDate.setUTCHours(0);

	const rates: Prisma.ExchangeRateCreateManyInput[] = [];
	for (
		let d = new Date(startDate);
		d <= new Date();
		d = new Date(d.getTime() + 86_400_000)
	)
		rates.push({
			date: new Date(d),
			currency: "ARS",
			type: "blue",
			rate: new Prisma.Decimal(1_000 + rates.length),
		});
	await adminDb.exchangeRate.createMany({ data: rates, skipDuplicates: true });

	const cats = await Promise.all(
		Array.from({ length: ENVELOPES - 1 }, (_, i) =>
			adminDb.category.create({
				data: { name: `Perf ${i}`, color: "blue", userId: user.id },
			}),
		),
	);
	const bookId = randomUUID();
	await adminDb.budgetBook.create({
		data: {
			id: bookId,
			currency: "ARS",
			startDate,
			startMonth: start,
			createdById: user.id,
			timeZone: "UTC",
		},
	});
	await adminDb.budgetMember.create({ data: { bookId, userId: user.id } });
	await adminDb.bookPeriod.create({
		data: { bookId, fromMonth: start, startDay: 1, rateType: "blue" },
	});
	const groupId = randomUUID();
	await adminDb.envelopeGroup.create({
		data: {
			id: groupId,
			bookId,
			name: "Spending",
			role: "SPENDING",
			sortOrder: 0,
		},
	});
	const envs = Array.from({ length: ENVELOPES }, () => randomUUID());
	await adminDb.envelope.createMany({
		data: envs.map((id, i) => ({
			id,
			bookId,
			groupId,
			name: `Envelope ${i}`,
			sortOrder: i,
			targetAmount: new Prisma.Decimal(100_000),
			targetStartMonth: start,
		})),
	});
	await adminDb.envelopeCategory.createMany({
		data: cats.map((c, i) => ({
			bookId,
			envelopeId: envs[i] as string,
			categoryId: c.id,
		})),
	});
	await adminDb.budgetBook.update({
		where: { id: bookId },
		data: { defaultEnvelopeId: envs[ENVELOPES - 1] },
	});

	const months = Array.from({ length: MONTHS }, (_, i) => addMonths(start, i));
	const row = (
		m: number,
		day: number,
		amount: number,
		usd: boolean,
		i: number,
	) => ({
		userId: user.id,
		title: `Row ${i}`,
		amount: new Prisma.Decimal(usd ? amount / 1000 : amount),
		currency: usd ? "USD" : "ARS",
		date: monthDate(m, day),
		categoryId: cats[i % cats.length]?.id ?? null,
		amountInUSD: new Prisma.Decimal(amount / 1000),
		exchangeRate: new Prisma.Decimal(usd ? 1 : 1000),
		pricingSource: "MANUAL",
	});
	const spending = Array.from({ length: EXPENSES }, (_, i) =>
		row(
			months[i % MONTHS] as number,
			1 + (i % 27),
			1_000 + (i % 50) * 100,
			i % 10 === 0,
			i,
		),
	);
	for (let i = 0; i < spending.length; i += 1_000)
		await adminDb.expense.createMany({ data: spending.slice(i, i + 1_000) });
	await adminDb.expense.createMany({
		data: months.map((m, i) => ({
			...row(m, 5, 2_400_000, false, i),
			categoryId: null,
			direction: "IN" as const,
			inType: "INCOME" as const,
		})),
	});
	await adminDb.budgetMovement.createMany({
		data: months.flatMap((m) =>
			envs.map((to) => ({
				id: randomUUID(),
				bookId,
				month: m,
				toEnvelopeId: to,
				amount: new Prisma.Decimal(100_000),
				kind: "ASSIGN" as const,
				actorUserId: user.id,
			})),
		),
	});
	return user.id;
}

describe("getMonth performance (3 years, 5,000 expenses)", () => {
	it("p95 under 250 ms", { timeout: 180_000 }, async () => {
		const userId = await seedThreeYears();
		for (let i = 0; i < 3; i++) await getMonth(userId);
		const runs: number[] = [];
		for (let i = 0; i < 30; i++) {
			const t = performance.now();
			const view = await getMonth(userId);
			runs.push(performance.now() - t);
			expect(view?.incomplete).toBe(false);
		}
		runs.sort((a, b) => a - b);
		const p50 = runs[Math.floor(runs.length / 2)] as number;
		const p95 = runs[Math.ceil(runs.length * 0.95) - 1] as number;
		console.log(
			`getMonth 3y/5000: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${runs.at(-1)?.toFixed(1)} ms`,
		);
		expect(p95).toBeLessThan(250);
	});
});

/**
 * getMonth on a 3-year book (SPEC §5.13, build plan 02 §5.3): 36 months,
 * 5,000 expenses (a tenth in USD, valued at the book's blue rate), monthly
 * salary, 15 envelopes assigned every month, and splits (P3): 720 shared
 * expenses (half paid by you for three, half paid by a friend), a payment
 * each month and a project. A second project is routed Not in budget and
 * holds 3,600 more of your shares (100 a month), plus a few rejected ones, so
 * the rows the envelope loads and drops (and Insights All time reads) are the
 * size a heavy user has. Months before this one are closed by the first
 * read (P4); there are no checkpoints yet, so each read is the full pass.
 * Target p95 under 250 ms on harbor; the measured numbers are printed for
 * the report.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "~/server/db";
import { insightsFirstDay } from "~/server/services/insights";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
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
		data: { homeCurrency: "COP" },
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
			currency: "COP",
			type: "blue",
			rate: new Prisma.Decimal(1_000 + rates.length),
		});
	await adminDb.exchangeRate.createMany({ data: rates, skipDuplicates: true });

	const cats = await Promise.all(
		Array.from({ length: ENVELOPES - 1 }, (_, i) =>
			fixtureDb.category.create({
				data: { name: `Perf ${i}`, color: "blue", userId: user.id },
			}),
		),
	);
	const bookId = randomUUID();
	await adminDb.budgetBook.create({
		data: {
			id: bookId,
			currency: "COP",
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
		currency: usd ? "USD" : "COP",
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
		await fixtureDb.expense.createMany({ data: spending.slice(i, i + 1_000) });
	await fixtureDb.expense.createMany({
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
	await seedSplits(user.id, months, monthDate, cats[0]?.id ?? null);
	return user.id;
}

const SPLITS_PER_MONTH = 20;
const OFF_BUDGET_PER_MONTH = 100;
const REJECTED_PER_MONTH = 5;
const share = (participantType: "user" | "shadow", participantId: string) => ({
	participantType,
	participantId,
	shareAmount: new Prisma.Decimal(10_000),
	verificationStatus: "ACCEPTED" as const,
});

/** A friend pays you back part of what you fronted, once a month. */
async function monthlyPayment(
	from: string,
	to: string,
	paidOn: Date,
): Promise<void> {
	const paymentId = randomUUID();
	await adminDb.payment.create({
		data: {
			id: paymentId,
			payerType: "user",
			payerId: from,
			payeeType: "user",
			payeeId: to,
			amount: new Prisma.Decimal(50_000),
			currency: "COP",
			paidOn,
			recordedByType: "user",
			recordedById: to,
			status: "FINALIZED",
		},
	});
	await adminDb.settlement.create({
		data: {
			fromParticipantType: "user",
			fromParticipantId: from,
			toParticipantType: "user",
			toParticipantId: to,
			amount: new Prisma.Decimal(50_000),
			currency: "COP",
			status: "FINALIZED",
			confirmedByPayer: true,
			confirmedByPayee: true,
			settledAt: paidOn,
			paymentGroupId: paymentId,
		},
	});
}

/** Splits over the three years: you paid half of them for three people, a friend paid the rest. */
async function seedSplits(
	userId: string,
	months: number[],
	monthDate: (m: number, day: number) => Date,
	categoryId: string | null,
) {
	const { user: friend } = await createTestUser();
	const shadow = await adminDb.shadowProfile.create({
		data: { createdById: userId, name: "Perf friend" },
	});
	const project = await adminDb.project.create({
		data: {
			name: "Perf trip",
			createdById: userId,
			participants: {
				create: [
					{ participantType: "user", participantId: userId, role: "ORGANIZER" },
					{ participantType: "user", participantId: friend.id },
				],
			},
		},
	});
	for (const m of months) {
		for (let i = 0; i < SPLITS_PER_MONTH; i++) {
			const payer = i % 2 === 0 ? userId : friend.id;
			await adminDb.sharedTransaction.create({
				data: {
					description: `Split ${m} ${i}`,
					amount: new Prisma.Decimal(30_000),
					currency: "COP",
					exchangeRate: new Prisma.Decimal(1_000),
					date: monthDate(m, 1 + (i % 27)),
					categoryId: payer === userId ? categoryId : null,
					projectId: i % 5 === 0 ? project.id : null,
					paidByType: "user",
					paidById: payer,
					createdByType: "user",
					createdById: payer,
					splitParticipants: {
						create: [
							share("user", userId),
							share("user", friend.id),
							share("shadow", shadow.id),
						],
					},
				},
			});
		}
		await monthlyPayment(friend.id, userId, monthDate(m, 20));
	}
	await seedOffBudget(userId, friend.id, months, monthDate);
}

/**
 * A Not in budget project with a big history: your share of each expense
 * (counted in Insights, left out of the envelope), and a few shares you
 * rejected (left out of both).
 */
async function seedOffBudget(
	userId: string,
	friendId: string,
	months: number[],
	monthDate: (m: number, day: number) => Date,
) {
	const project = await adminDb.project.create({
		data: {
			name: "Perf off budget",
			createdById: userId,
			participants: {
				create: [
					{
						participantType: "user",
						participantId: userId,
						role: "ORGANIZER",
						budgetRouting: "NOT_IN_BUDGET",
					},
					{ participantType: "user", participantId: friendId },
				],
			},
		},
	});
	const transactions: Prisma.SharedTransactionCreateManyInput[] = [];
	const shares: Prisma.SplitParticipantCreateManyInput[] = [];
	for (const m of months)
		for (let i = 0; i < OFF_BUDGET_PER_MONTH; i++) {
			const id = randomUUID();
			transactions.push({
				id,
				description: `Off budget ${m} ${i}`,
				amount: new Prisma.Decimal(20_000),
				currency: "COP",
				exchangeRate: new Prisma.Decimal(1_000),
				date: monthDate(m, 1 + (i % 27)),
				projectId: project.id,
				paidByType: "user",
				paidById: friendId,
				createdByType: "user",
				createdById: friendId,
			});
			const mine = {
				...share("user", userId),
				transactionId: id,
				verificationStatus:
					i < REJECTED_PER_MONTH
						? ("REJECTED" as const)
						: ("ACCEPTED" as const),
			};
			shares.push(mine, { ...share("user", friendId), transactionId: id });
		}
	for (let i = 0; i < transactions.length; i += 1_000)
		await adminDb.sharedTransaction.createMany({
			data: transactions.slice(i, i + 1_000),
		});
	for (let i = 0; i < shares.length; i += 1_000)
		await adminDb.splitParticipant.createMany({
			data: shares.slice(i, i + 1_000),
		});
}

function p95Of(runs: number[]) {
	runs.sort((a, b) => a - b);
	return {
		p50: runs[Math.floor(runs.length / 2)] as number,
		p95: runs[Math.ceil(runs.length * 0.95) - 1] as number,
		max: runs.at(-1) as number,
	};
}

describe("getMonth performance (3 years, 5,000 expenses, 720 splits, 3,600 off budget)", () => {
	it("p95 under 250 ms", { timeout: 180_000 }, async () => {
		const userId = await seedThreeYears();
		// Production tables carry planner statistics; a fresh test database does not until autovacuum gets to it.
		await adminDb.$executeRawUnsafe("ANALYZE");
		for (let i = 0; i < 3; i++) await getMonth(userId);
		// The first read closed every month before this one (P4): timed reads use the snapshots.
		await expect(
			adminDb.monthClose.count({ where: { book: { createdById: userId } } }),
		).resolves.toBe(MONTHS - 1);
		const runs: number[] = [];
		for (let i = 0; i < 30; i++) {
			const t = performance.now();
			const view = await getMonth(userId);
			runs.push(performance.now() - t);
			expect(view?.incomplete).toBe(false);
		}
		const { p50, p95, max } = p95Of(runs);
		console.log(
			`getMonth 3y/5000+720 splits+3600 off budget: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`,
		);
		// Insights All time reads every share that counts, over all history.
		const firstDay: number[] = [];
		for (let i = 0; i < 30; i++) {
			const t = performance.now();
			await insightsFirstDay(db, userId);
			firstDay.push(performance.now() - t);
		}
		const fd = p95Of(firstDay);
		console.log(
			`insightsFirstDay all time: p50 ${fd.p50.toFixed(1)} ms, p95 ${fd.p95.toFixed(1)} ms, max ${fd.max.toFixed(1)} ms`,
		);
		expect(p95).toBeLessThan(250);
	});
});

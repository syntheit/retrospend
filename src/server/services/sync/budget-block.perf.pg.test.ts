/**
 * What the budget block costs at the size a heavy user has (E2EE P13b PR 1c):
 * a 36-month book with 10,000 expenses (a tenth in USD, valued at the book's
 * blue rate), 15 envelopes, monthly salary and assigned money, and 720 shared
 * expenses with a monthly payment. The two transactions of a pull are timed
 * apart: tx1 (the freeze, a full read that writes the first values) cold and
 * warm, tx2 (the snapshot with the block) after it, and the size of the block
 * on the wire. The numbers are logged for the report, not asserted: the
 * assertions are that nothing is left to freeze and that the block holds every
 * value the user's own rows kept.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { toSyncBudget } from "../api-v1/sync-snapshots";
import { addMonths } from "../envelope/calendar";
import { budgetMonthOf, isoDateIn } from "../envelope/months";
import { runFreeze } from "./budget-block";
import { readShareSnapshot } from "./snapshots";

const EXPENSES = 10_000;
const MONTHS = 36;
const ENVELOPES = 15;
const SPLITS_PER_MONTH = 20;

async function seed() {
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
	const { user: friend } = await createTestUser();
	const share = (participantType: "user", participantId: string) => ({
		participantType,
		participantId,
		shareAmount: new Prisma.Decimal(10_000),
		verificationStatus: "ACCEPTED" as const,
	});
	for (const m of months)
		for (let i = 0; i < SPLITS_PER_MONTH; i++) {
			const payer = i % 2 === 0 ? user.id : friend.id;
			await fixtureDb.sharedTransaction.create({
				data: {
					description: `Split ${m} ${i}`,
					amount: new Prisma.Decimal(20_000),
					currency: "COP",
					exchangeRate: new Prisma.Decimal(1_000),
					date: monthDate(m, 1 + (i % 27)),
					categoryId: payer === user.id ? (cats[0]?.id ?? null) : null,
					paidByType: "user",
					paidById: payer,
					createdByType: "user",
					createdById: payer,
					splitParticipants: {
						create: [share("user", user.id), share("user", friend.id)],
					},
				},
			});
		}
	return user.id;
}

const ms = (since: number) => Math.round(performance.now() - since);

describe("the budget block at 10,000 expenses", () => {
	it("times tx1 and tx2 and sizes the block", async () => {
		const userId = await seed();
		const usd = Math.ceil(EXPENSES / 10);

		const coldAt = performance.now();
		expect(await runFreeze(adminDb, userId, { force: true })).toBe("ran");
		const cold = ms(coldAt);

		const warmAt = performance.now();
		expect(await runFreeze(adminDb, userId, { force: true })).toBe("ran");
		const warm = ms(warmAt);

		// tx1 is quiet now (the stamps are unchanged), so this is tx2 alone.
		const pullAt = performance.now();
		const snapshot = await readShareSnapshot(adminDb, userId, { budget: true });
		const pull = ms(pullAt);

		const plainAt = performance.now();
		await readShareSnapshot(adminDb, userId);
		const plain = ms(plainAt);

		if (snapshot.budget?.kind !== "block") throw new Error("no block");
		expect(snapshot.budget.unfrozen).toBe(0);
		// A tenth of the rows are USD with no booked value: one kept value each.
		expect(snapshot.budget.block.frozen).toHaveLength(usd);
		const bytes = Buffer.byteLength(
			JSON.stringify(toSyncBudget(snapshot.budget)),
		);
		console.log(
			`P13b-1c 10k: tx1 cold ${cold} ms (${usd} values frozen), tx1 warm ${warm} ms, ` +
				`pull with block (tx1 skipped, tx2 + freeze check) ${pull} ms, shares and owed alone ${plain} ms, ` +
				`block ${bytes} bytes (${snapshot.budget.block.frozen.length} frozen, ` +
				`${snapshot.budget.block.splits.shares.length} shares, ${snapshot.budget.block.splits.events.length} events)`,
		);
	}, 600_000);
});

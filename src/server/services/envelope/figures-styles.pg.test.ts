/**
 * The budget figures through createBudgetFigures(prismaBudgetReads), one book
 * per style, in an ARS book (2 decimals, large numbers). Rows are entered in
 * ARS, the book currency, so they count as entered and no rate is involved.
 * Expected values by hand:
 *
 *   Starting money   1,000,000.00 ARS            = 100,000,000 minor
 *   Assigned Dining    300,000.00                =  30,000,000
 *   Dining spent       150,000.50 + 12,500.25    =  16,250,075 ... less a refund
 *   Refund               5,000.00                =     500,000
 *     spent = 15,000,050 + 1,250,025 - 500,000   =  15,750,075
 *   Dining left = 30,000,000 - 15,750,075        =  14,249,925
 *   Not planned yet / To assign = 100,000,000 - 30,000,000 = 70,000,000
 *   Money in = 100,000,000
 *   Holds = 70,000,000 + 14,249,925              =  84,249,925
 *            (= money in - outflows: 100,000,000 - 15,750,075)
 *
 * Every style computes these the same way (styles are presets, B8); what
 * differs is the lead (Left in limits in Limits only), so those are checked
 * against the month view the same pass reads.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { budgetMonthOf, isoDateIn } from "./months";
import { assignEnvelopes } from "./movement.mutation";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const STYLES = [
	"LIMITS",
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
] as const;

/** ARS needs a rate dated today for the setup's starting balance (SPEC rates). */
async function arsRates() {
	const date = new Date(`${isoDateIn(new Date(), "UTC")}T00:00:00Z`);
	for (const [type, rate] of [
		["official", "1412"],
		["blue", "1465"],
	] as const)
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date, currency: "ARS", type } },
			create: { date, currency: "ARS", type, rate: new Prisma.Decimal(rate) },
			update: { rate: new Prisma.Decimal(rate) },
		});
}

function arsRow(
	userId: string,
	o: {
		amount: string;
		categoryId: string;
		direction?: "IN" | "OUT";
		inType?: "REFUND";
	},
) {
	return adminDb.expense.create({
		data: {
			userId,
			title: "Row",
			amount: new Prisma.Decimal(o.amount),
			currency: "ARS",
			date: new Date(),
			categoryId: o.categoryId,
			amountInUSD: new Prisma.Decimal(o.amount).div(1465).toDecimalPlaces(8),
			exchangeRate: new Prisma.Decimal(1465),
			pricingSource: "MANUAL",
			direction: o.direction ?? "OUT",
			entryKind: "STANDARD",
			inType: o.inType ?? null,
		},
	});
}

describe.each(STYLES)("budget figures, %s style, ARS book", (style) => {
	let userId: string;
	let ids: Record<string, string>;

	beforeAll(async () => {
		await arsRates();
		const s = await seedUser();
		userId = s.user.id;
		await forUser(userId).apply(setupEnvelopeBook, {
			...setupInput(s),
			style,
			currency: "ARS",
			startingMoneyMinor: 100_000_000,
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: userId },
			include: { envelopes: true },
		});
		ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
		const month = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
			{ fromMonth: 0, startDay: 1 },
		]);
		await forUser(userId).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month,
			mode: "add",
			items: [
				{
					id: randomUUID(),
					envelopeId: ids.Dining as string,
					amountMinor: 30_000_000,
				},
			],
		});
		await arsRow(userId, { amount: "150000.50", categoryId: s.dining });
		await arsRow(userId, { amount: "12500.25", categoryId: s.dining });
		await arsRow(userId, {
			amount: "5000",
			categoryId: s.dining,
			direction: "IN",
			inType: "REFUND",
		});
	});

	it("reads the figures that follow from the rows", async () => {
		const r = await readFigures(userId, [
			"budget.notPlannedYet",
			"budget.moneyIn",
			"budget.holds",
		]);
		// Limits assigns each limit itself: Rent 500.00 + Dining 200.00 = 70,000
		// minor more out of the pool, and Dining holds 20,000 more. Holds do not move.
		const limits = style === "LIMITS" ? 70_000 : 0;
		const diningLimit = style === "LIMITS" ? 20_000 : 0;
		expect(r.get("budget.notPlannedYet")).toEqual([ars(70_000_000 - limits)]);
		expect(r.get("budget.moneyIn")).toEqual([ars(100_000_000)]);
		expect(r.get("budget.holds")).toEqual([ars(84_249_925)]);
		const spent = await readFigures(
			userId,
			["envelope.spent", "envelope.left"],
			{ envelopeId: ids.Dining },
		);
		expect(spent.get("envelope.spent")).toEqual([ars(15_750_075)]);
		expect(spent.get("envelope.left")).toEqual([ars(14_249_925 + diningLimit)]);
	});

	it("reads the style's own figures as the month view the same book gives", async () => {
		const m = await getMonth(userId);
		const r = await readFigures(userId, [
			"budget.leftToSpend",
			"budget.leftInLimits",
			"budget.heldForOthers",
		]);
		expect(r.get("budget.leftToSpend")).toEqual([m?.leftToSpend.left]);
		const lead = m?.verdict.lead;
		expect(r.get("budget.leftInLimits")).toEqual(
			lead?.kind === "LEFT_IN_LIMITS" ? [lead.amount] : null,
		);
		expect(r.get("budget.heldForOthers")).toEqual([ars(0)]);
	});
});

describe("budget figures with a rate missing", () => {
	it("are unavailable, never a guess", async () => {
		await arsRates();
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			currency: "ARS",
			timeZone: "UTC",
		});
		// The book values in a rate type nothing is stored for, so a USD row has no rate.
		await adminDb.bookPeriod.updateMany({
			where: { book: { createdById: s.user.id } },
			data: { rateType: "xq-missing" },
		});
		await adminDb.expense.create({
			data: {
				userId: s.user.id,
				title: "Row",
				amount: new Prisma.Decimal("10"),
				currency: "USD",
				date: new Date(),
				categoryId: s.dining,
				amountInUSD: new Prisma.Decimal("10"),
				exchangeRate: new Prisma.Decimal(1),
				pricingSource: "MANUAL",
				direction: "OUT",
				entryKind: "STANDARD",
			},
		});
		const r = await readFigures(s.user.id, [
			"budget.notPlannedYet",
			"budget.holds",
			"budget.leftToSpend",
		]);
		expect(r.get("budget.notPlannedYet")).toBeNull();
		expect(r.get("budget.holds")).toBeNull();
		expect(r.get("budget.leftToSpend")).toBeNull();
	});
});

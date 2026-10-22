import { randomUUID } from "node:crypto";
import { fromMinorUnits, toMinorUnits, USD } from "~/lib/money";
import { addMonthsClamped } from "~/lib/recurring";
import type { Prisma, PrismaClient } from "~prisma";

export interface AmortizationSplit {
	id: string;
	date: Date;
	amount: number;
	amountInUSD: number;
}

/**
 * Splits `total` into `parts` whole minor units of `currency`; the first
 * parts take the leftover units, so the parts always add up to the total.
 */
function splitMinorUnits(total: number, parts: number, currency: string) {
	const units = toMinorUnits(total, currency);
	const base = Math.floor(units / parts);
	let remainder = units - base * parts;
	return Array.from({ length: parts }, () => {
		const extra = remainder > 0 ? 1 : 0;
		remainder -= extra;
		return fromMinorUnits(base + extra, currency);
	});
}

export class AmortizationService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Calculates monthly amortization splits with penny-perfect accuracy. The
	 * amount is split in the currency's own minor units (satoshis for BTC,
	 * fils for KWD, whole yen for JPY), the USD amount in cents.
	 */
	calculateSplits(
		startDate: Date,
		totalAmount: number,
		totalAmountInUSD: number,
		months: number,
		currency = USD,
	): AmortizationSplit[] {
		const amounts = splitMinorUnits(totalAmount, months, currency);
		const amountsInUSD = splitMinorUnits(totalAmountInUSD, months, USD);

		return amounts.map((amount, i) => ({
			id: randomUUID(),
			date: addMonthsClamped(startDate, i),
			amount,
			amountInUSD: amountsInUSD[i]!,
		}));
	}

	/**
	 * Clears existing child expenses and creates new ones based on amortization rules.
	 */
	async syncAmortization(
		expense: {
			id: string;
			userId: string;
			title: string;
			amount: number | Prisma.Decimal;
			amountInUSD: number | Prisma.Decimal;
			currency: string;
			exchangeRate: number | Prisma.Decimal;
			pricingSource: string | null;
			date: Date;
			categoryId: string | null;
			excludeFromAnalytics?: boolean | null;
			rateType?: string | null;
			homeCurrency?: string | null;
			homeRate?: number | string | Prisma.Decimal | null;
			homeAmount?: number | string | Prisma.Decimal | null;
		},
		amortizeOver: number,
	) {
		// 1. Delete existing children
		await this.db.expense.deleteMany({
			where: { parentId: expense.id, userId: expense.userId },
		});

		if (amortizeOver <= 1) return;

		// 2. Calculate new splits
		const splits = this.calculateSplits(
			expense.date,
			Number(expense.amount),
			Number(expense.amountInUSD),
			amortizeOver,
			expense.currency,
		);

		// The booked home amount splits like the amount, so the parts add up
		// to the parent's home value and none of them drifts either.
		const { homeCurrency, homeRate, homeAmount } = expense;
		const homeParts =
			homeCurrency && homeRate != null && homeAmount != null
				? splitMinorUnits(Number(homeAmount), amortizeOver, homeCurrency)
				: null;

		// 3. Create new children. They carry the parent's rate and its
		// excludeFromAnalytics flag, so an excluded purchase stays excluded
		// month by month.
		const children = splits.map((split, i) => ({
			rateType: expense.rateType ?? null,
			...(homeParts
				? { homeCurrency, homeRate, homeAmount: homeParts[i] }
				: {}),
			id: split.id,
			userId: expense.userId,
			title: `${expense.title} (${i + 1}/${amortizeOver})`,
			amount: split.amount,
			currency: expense.currency,
			amountInUSD: split.amountInUSD,
			exchangeRate: Number(expense.exchangeRate),
			pricingSource: expense.pricingSource ?? "MANUAL",
			date: split.date,
			categoryId: expense.categoryId || undefined,
			excludeFromAnalytics: expense.excludeFromAnalytics ?? false,
			isAmortizedChild: true,
			parentId: expense.id,
			status: "FINALIZED" as const,
		}));

		await this.db.expense.createMany({ data: children });
	}
}

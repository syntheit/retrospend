import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "~prisma";

export interface AmortizationSplit {
	id: string;
	date: Date;
	amount: number;
	amountInUSD: number;
}

export class AmortizationService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Safely adds months to a date, clamping to the last day of the month if the day exceeds the target month's length.
	 */
	private addMonthsClamped(baseDate: Date, monthsToAdd: number): Date {
		const date = new Date(baseDate);
		const targetMonth = date.getMonth() + monthsToAdd;

		date.setMonth(targetMonth);

		if (date.getMonth() % 12 !== (targetMonth + 12) % 12) {
			date.setDate(0);
		}

		return date;
	}

	/**
	 * Calculates monthly amortization splits with penny-perfect accuracy.
	 */
	calculateSplits(
		startDate: Date,
		totalAmount: number,
		totalAmountInUSD: number,
		months: number,
	): AmortizationSplit[] {
		const splits: AmortizationSplit[] = [];
		const precision = 2;
		const multiplier = 10 ** precision;

		const totalUnits = Math.round(totalAmount * multiplier);
		const totalUnitsInUSD = Math.round(totalAmountInUSD * multiplier);

		const baseUnits = Math.floor(totalUnits / months);
		const baseUnitsInUSD = Math.floor(totalUnitsInUSD / months);

		let remainingUnits = totalUnits - baseUnits * months;
		let remainingUnitsInUSD = totalUnitsInUSD - baseUnitsInUSD * months;

		for (let i = 0; i < months; i++) {
			const date = this.addMonthsClamped(startDate, i);

			let currentUnits = baseUnits;
			let currentUnitsInUSD = baseUnitsInUSD;

			if (remainingUnits > 0) {
				currentUnits += 1;
				remainingUnits -= 1;
			}
			if (remainingUnitsInUSD > 0) {
				currentUnitsInUSD += 1;
				remainingUnitsInUSD -= 1;
			}

			splits.push({
				id: randomUUID(),
				date,
				amount: currentUnits / multiplier,
				amountInUSD: currentUnitsInUSD / multiplier,
			});
		}

		return splits;
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
			exchangeRate: number | Prisma.Decimal | null;
			pricingSource: string | null;
			date: Date;
			categoryId: string | null;
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
		);

		// 3. Create new children
		const children = splits.map((split, i) => ({
			id: split.id,
			userId: expense.userId,
			title: `${expense.title} (${i + 1}/${amortizeOver})`,
			amount: split.amount,
			currency: expense.currency,
			amountInUSD: split.amountInUSD,
			exchangeRate: Number(expense.exchangeRate ?? 1),
			pricingSource: expense.pricingSource ?? "MANUAL",
			date: split.date,
			categoryId: expense.categoryId || undefined,
			isAmortizedChild: true,
			parentId: expense.id,
			status: "FINALIZED" as const,
		}));

		await this.db.expense.createMany({ data: children });
	}
}

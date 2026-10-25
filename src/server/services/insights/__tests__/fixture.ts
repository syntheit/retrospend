/**
 * Rows for the Insights pg tests. DKK is the home currency of these tests and
 * no other pg file prices it, so the rates seeded here never move another
 * file's numbers in the shared run database.
 */
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";

export const dkk = (minor: number) => ({ minor, currency: "DKK" });
export const usd = (minor: number) => ({ minor, currency: "USD" });

/** DKK per USD: 7.00 from October 1, 2026, the only rate row, so every date reads it. */
export async function seedDkkRates() {
	const day = new Date("2026-10-01T00:00:00.000Z");
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: day, currency: "DKK", type: "official" },
		},
		create: { date: day, currency: "DKK", type: "official", rate: "7" },
		update: {},
	});
}

export async function insightsUser(
	options: { zone?: string | null; startDay?: number } = {},
) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: {
			homeCurrency: "DKK",
			fiscalMonthStartDay: options.startDay ?? 1,
			timeZone:
				options.zone === undefined
					? "America/Argentina/Buenos_Aires"
					: options.zone,
		},
	});
	return user.id;
}

export function category(userId: string, name: string) {
	return adminDb.category
		.create({ data: { name, color: "emerald", userId } })
		.then((c) => c.id);
}

export interface Row {
	/** An ISO instant: the tests write the zone's wall clock as an explicit offset. */
	at: string;
	amount: string;
	currency?: string;
	/** The stored USD value, frozen when the row was saved. */
	usd: string;
	categoryId?: string;
	kind?: "spending" | "refund" | "income";
}

export function row(userId: string, r: Row) {
	const currency = r.currency ?? "DKK";
	const kind = r.kind ?? "spending";
	return adminDb.expense.create({
		data: {
			userId,
			title: "Row",
			amount: new Prisma.Decimal(r.amount),
			currency,
			date: new Date(r.at),
			amountInUSD: new Prisma.Decimal(r.usd),
			exchangeRate: new Prisma.Decimal(currency === "USD" ? 1 : 7),
			pricingSource: "MANUAL",
			categoryId: r.categoryId ?? null,
			direction: kind === "spending" ? "OUT" : "IN",
			inType:
				kind === "spending" ? null : kind === "refund" ? "REFUND" : "INCOME",
		},
	});
}

/** A shared expense `payer` paid, with `userId`'s share and optionally another person's. */
export function sharedExpense(o: {
	payer: string;
	userId: string;
	share: string;
	at: string;
	currency?: string;
	projectId?: string;
	withShadow?: string;
}) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount: o.share,
			currency: o.currency ?? "DKK",
			date: new Date(o.at),
			paidByType: "user",
			paidById: o.payer,
			createdByType: "user",
			createdById: o.payer,
			projectId: o.projectId ?? null,
			splitParticipants: {
				create: [
					{
						participantType: "user",
						participantId: o.userId,
						shareAmount: o.share,
						verificationStatus: "ACCEPTED",
					},
					...(o.withShadow
						? [
								{
									participantType: "shadow" as const,
									participantId: o.withShadow,
									shareAmount: "0",
									verificationStatus: "ACCEPTED" as const,
								},
							]
						: []),
				],
			},
		},
	});
}

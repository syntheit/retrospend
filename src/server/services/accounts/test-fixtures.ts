/**
 * Fixtures for the account, transfer and income pg tests (MONEY-MOVES
 * conventions): ARS home, today's rates ARS 1,468 Blue, 1,412 Official and
 * 1,449 MEP per USD. Accounts are created through the real service and
 * dated ten days ago, so moves today land after their first balance.
 */
import { dayKey } from "~/lib/time-zone";
import { readFigures } from "~/server/figures/read";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { AssetType } from "~prisma";
import { type AccountFields, createAccount } from "./manage";

/**
 * Today as the services date a move made without a zone: the process's own
 * calendar day (accounts/dates.ts), not the UTC one, so the tests pass at
 * any hour in any TZ.
 */
export const TODAY = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
/** A day as the YYYY-MM-DD a money move takes. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const daysAgo = (n: number) =>
	new Date(TODAY.getTime() - n * 86_400_000);
export const ars = (major: number) => ({
	minor: Math.round(major * 100),
	currency: "ARS",
});

export async function seedArsRates() {
	for (const [type, rate] of [
		["blue", "1468"],
		["official", "1412"],
		["mep", "1449"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: TODAY, currency: "ARS", type } },
			create: { date: TODAY, currency: "ARS", type, rate },
			update: { rate },
		});
	}
}

export async function arsUser() {
	const user = await createTestUser();
	await adminDb.user.update({
		where: { id: user.user.id },
		data: { homeCurrency: "ARS" },
	});
	return user;
}

/** An account created through the service, its first balance dated `ageDays` ago. */
export async function openAccount(
	userId: string,
	name: string,
	type: AssetType,
	currency: string,
	balance: number,
	extra: Partial<AccountFields> = {},
	ageDays = 10,
) {
	const account = await createAccount(adminDb, userId, {
		name,
		type,
		currency,
		balance,
		isLiquid: type === "CASH",
		...extra,
	});
	await adminDb.assetSnapshot.updateMany({
		where: { accountId: account.id },
		data: { date: daysAgo(ageDays), recordedAt: daysAgo(ageDays) },
	});
	return account.id;
}

export async function balanceOf(accountId: string): Promise<string> {
	const account = await adminDb.assetAccount.findUniqueOrThrow({
		where: { id: accountId },
		select: { balance: true },
	});
	return account.balance.toString();
}

/** One figure for the user, through the real read path (RLS). */
export async function figure(userId: string, id: string, accountId?: string) {
	const readings = await readFigures(
		userId,
		[id],
		accountId ? { accountId } : {},
	);
	return readings.get(id) ?? null;
}

/** The one-currency amount of a figure, or null. */
export async function figureMinor(
	userId: string,
	id: string,
	currency = "ARS",
) {
	const reading = await figure(userId, id);
	return reading?.find((m) => m.currency === currency)?.minor ?? null;
}

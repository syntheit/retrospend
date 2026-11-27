/** What the transfer vectors share: the rate table, the accounts they move between, and the request builders. */
import { type SeedAccount, uuid } from "./account-vector-types";
import { BA, rate, seed } from "./expense-create-vectors";
import type { TransferBody } from "./transfer-create-local";

export { uuid };

/** ARS blue 1,545 and official 1,050 per USD, JPY official 150, QQQ official 0.9, all from Nov 1. */
export const RATES = [
	rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
	rate("ARS", "official", "1050", "2026-11-01T00:00:00Z"),
	rate("JPY", "official", "150", "2026-11-01T00:00:00Z"),
	rate("QQQ", "official", "0.9", "2026-11-01T00:00:00Z"),
];
export const ARS_HOME = seed("ARS", BA, RATES);

export const NOV10 = "2026-11-10T15:00:00Z"; // Buenos Aires Nov 10, 12:00
/** The fee expense's instant: the start of Nov 10 in Buenos Aires (UTC-3). */
export const FEE_DAY = "2026-11-10T03:00:00.000Z";

/** Account ids. */
export const ARS1 = uuid(101);
export const ARS2 = uuid(102);
export const USD_BLUE = uuid(103);
export const USD_OFFICIAL = uuid(104);
export const USD_COUNTED = uuid(105);
export const USD_OUT = uuid(106);
export const QQQ = uuid(107);
export const ZZZ = uuid(108);

const cash = (
	id: string,
	currency: string,
	balance: string,
	over: Partial<SeedAccount> = {},
): SeedAccount => ({
	id,
	name: `${currency} ${balance}`,
	type: "CASH",
	currency,
	balance,
	exchangeRate: null,
	exchangeRateType: null,
	...over,
});

const usd = (
	id: string,
	balance: string,
	type: "blue" | "official",
	over: Partial<SeedAccount> = {},
): SeedAccount => ({
	...cash(id, "USD", balance, over),
	type: "INVESTMENT",
	exchangeRate: "1",
	exchangeRateType: type,
	...over,
});

export const accounts = {
	ars1: cash(ARS1, "ARS", "5000000"),
	ars2: cash(ARS2, "ARS", "100000"),
	/** Part of the budget on purpose: a move into it does not cross the line. */
	usdBlue: usd(USD_BLUE, "2000", "blue", { inBudget: true }),
	usdOfficial: usd(USD_OFFICIAL, "500", "official", { inBudget: true }),
	/** Outside the budget (the default for foreign money), holding 300 counted units. */
	usdCounted: usd(USD_COUNTED, "500", "official", { countedUnits: "300" }),
	usdOut: usd(USD_OUT, "50", "official"),
	/** Holds a stale stored rate of 0.5: a fee on it is valued at the day's 0.9. */
	qqq: cash(QQQ, "QQQ", "1000", { exchangeRate: "0.5" }),
	/** In the budget, with no rate anywhere. */
	zzz: cash(ZZZ, "ZZZ", "1000", { inBudget: true }),
};

/** A create body with the ids a case numbers. */
export const create = (
	n: number,
	body: Partial<TransferBody> &
		Pick<TransferBody, "fromAccountId" | "toAccountId" | "fromAmount">,
) =>
	({
		kind: "transferCreate",
		body: {
			id: uuid(200 + n),
			fromLegId: uuid(300 + 2 * n),
			toLegId: uuid(301 + 2 * n),
			feeLegId: uuid(350 + n),
			feeExpenseId: uuid(400 + n),
			...body,
		},
	}) as const;

export const remove = (n: number) =>
	({ kind: "transferDelete", body: { id: uuid(200 + n) } }) as const;

/** The ids create(n) makes. */
export const idsOf = (n: number) => ({
	transfer: uuid(200 + n),
	from: uuid(300 + 2 * n),
	to: uuid(301 + 2 * n),
	fee: uuid(350 + n),
	expense: uuid(400 + n),
});

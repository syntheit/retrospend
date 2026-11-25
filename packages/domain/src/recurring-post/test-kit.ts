/**
 * The base case of the recurring characterization tests (src/server/services/
 * __tests__/recurring-write-kit.ts), as plain data for the fake store: home
 * ARS, preferred USD type blue, saved zone Buenos Aires (UTC-3, no DST), a
 * monthly USD 20 template on the 1st due 2026-12-01T03:00Z. Test support only.
 */
import { type FakeRate, FakeStore } from "./fake-port";
import type { PostTemplate } from "./plan";

export const BA = "America/Argentina/Buenos_Aires";
export const TOKYO = "Asia/Tokyo";
export const ME = "me";

/** Buenos Aires midnight is 03:00Z all year. */
export const ba = (day: string) => new Date(`${day}T03:00:00.000Z`);
export const at = (instant: string) => new Date(instant);

/** A rate row dated at UTC midnight, as the rate table stores a day. */
export const rate = (
	day: string,
	currency: string,
	type: string,
	value: number,
): FakeRate => ({
	currency,
	type,
	date: new Date(`${day}T00:00:00.000Z`),
	rate: value,
});

/** Blue 1,500 on Nov 1, 1,540 on Nov 29, 1,545 on Nov 30; official 1,050 on Dec 1 (the newest). */
export const BASE_RATES: readonly FakeRate[] = [
	rate("2026-11-01", "ARS", "blue", 1500),
	rate("2026-11-29", "ARS", "blue", 1540),
	rate("2026-11-30", "ARS", "blue", 1545),
	rate("2026-12-01", "ARS", "official", 1050),
];

export const BASE_TEMPLATE: Omit<PostTemplate, "stamp"> = {
	id: "t1",
	userId: ME,
	amount: "20",
	currency: "USD",
	categoryId: null,
	nextDueDate: ba("2026-12-01"),
	direction: "OUT",
	amountMode: "FIXED",
	frequency: "MONTHLY",
	anchorDay: 1,
	isActive: true,
	autoPay: true,
};

export interface BaseOptions {
	template?: Partial<Omit<PostTemplate, "stamp">>;
	rates?: readonly FakeRate[];
	/** Preferred rate type per home currency; blue for ARS by default. */
	preferred?: Readonly<Record<string, string>>;
	homeCurrency?: string;
	zone?: string;
}

export function baseStore(options: BaseOptions = {}): FakeStore {
	return new FakeStore({
		template: { ...BASE_TEMPLATE, ...options.template },
		homeCurrency: options.homeCurrency ?? "ARS",
		preferred: options.preferred ?? { ARS: "blue" },
		rates: options.rates ?? BASE_RATES,
		zone: options.zone ?? BA,
		caller: ME,
	});
}

/** The posted dates of a store's expenses, oldest first, as ISO text. */
export const datesOf = (store: FakeStore) =>
	store.expenses.map((e) => e.date.toISOString());

/** The home amounts of a store's expenses, in the order they were posted. */
export const homeOf = (store: FakeStore) =>
	store.expenses.map((e) => e.homeAmount);

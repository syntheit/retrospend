/**
 * What the e2e personas own, as plain data relative to one anchor day.
 *
 * Every date is "N days before the anchor", so the same seed gives the same
 * picture whatever day the suite runs (like .staging/seed-demo.mjs).
 * Random-looking spending comes from the staging seed's LCG with its seed.
 * Amounts are numbers here; seed.ts stores them through the app's own money
 * helpers (minor-unit rounding, amountInUSD), never through ad hoc math.
 *
 * E2E_SEED_TODAY=YYYY-MM-DD only moves the seed's anchor, to rebuild a past
 * run's rows. It does not move the app's clock: the server and the browser
 * still use the real date for "this month" and "today".
 */
import { fromWallTime, wallTime } from "@retrospend/domain/time-zone";
import { type PersonKey, SEED_TIME_ZONE } from "./personas";

export interface Anchor {
	year: number;
	/** 0-based. */
	month: number;
	day: number;
}

export function seedAnchor(
	pinned = process.env.E2E_SEED_TODAY,
	now = new Date(),
): Anchor {
	if (pinned) {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pinned);
		if (!match) throw new Error("E2E_SEED_TODAY must be YYYY-MM-DD");
		return {
			year: Number(match[1]),
			month: Number(match[2]) - 1,
			day: Number(match[3]),
		};
	}
	const { year, month, day } = wallTime(now, SEED_TIME_ZONE);
	return { year, month, day };
}

/**
 * Start of the day in Buenos Aires, `back` days before the anchor. Midnight
 * is how the app stores a date-only entry, and it keeps "today" rows from
 * landing later than the moment the suite runs.
 */
export function daysAgo(anchor: Anchor, back: number): Date {
	return fromWallTime(
		{ year: anchor.year, month: anchor.month, day: anchor.day - back },
		SEED_TIME_ZONE,
	);
}

/** Units of currency per USD, one row per currency, valid for every date. */
export const SEED_RATES = [
	{ currency: "ARS", type: "official", rate: 1450 },
	{ currency: "BRL", type: "official", rate: 5.4 },
] as const;

export function seedRate(currency: string): number {
	if (currency === "USD") return 1;
	const row = SEED_RATES.find((r) => r.currency === currency);
	if (!row) throw new Error(`No seed rate for ${currency}`);
	return row.rate;
}

export interface PersonalExpense {
	title: string;
	amount: number;
	currency: "ARS" | "USD";
	category: string;
	back: number;
}

type Add = (e: Omit<PersonalExpense, "back">) => void;

const DAYS_OF_HISTORY = 120;

/** Bills Sofía pays herself on a fixed day of the month. */
// biome-ignore format: one row per bill reads as a table
const MONTHLY_BILLS: readonly (Omit<PersonalExpense, "back"> & { day: number })[] = [
	{ day: 3, title: "Alquiler depto", amount: 650000, currency: "ARS", category: "Rent" },
	{ day: 5, title: "Gimnasio Megatlon", amount: 62000, currency: "ARS", category: "Health" },
	{ day: 15, title: "Netflix", amount: 12.99, currency: "USD", category: "Subscriptions" },
	{ day: 16, title: "Spotify", amount: 4200, currency: "ARS", category: "Subscriptions" },
	{ day: 18, title: "iCloud 200GB", amount: 2.99, currency: "USD", category: "Subscriptions" },
	{ day: 20, title: "Monotributo", amount: 42000, currency: "ARS", category: "Taxes" },
];

/** One-off USD purchases. */
// biome-ignore format: one row per purchase reads as a table
const ONE_OFFS: readonly PersonalExpense[] = [
	{ title: "Dominio sofiareyes.dev", amount: 14.5, currency: "USD", category: "Subscriptions", back: 100 },
	{ title: "Auriculares Sony", amount: 189.99, currency: "USD", category: "Electronics", back: 70 },
	{ title: "Monitor Samsung", amount: 320, currency: "USD", category: "Electronics", back: 45 },
	{ title: "GitHub Copilot", amount: 10, currency: "USD", category: "Subscriptions", back: 25 },
];

/** The staging seed's generator: the same seed gives the same sequence. */
function stagingRandom() {
	let state = 20261021;
	const rnd = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	return {
		rnd,
		pick: <T>(items: readonly T[]): T =>
			items[Math.floor(rnd() * items.length)] as T,
		between: (lo: number, hi: number, step: number) =>
			Math.round((lo + rnd() * (hi - lo)) / step) * step,
	};
}

/** Daily life on one day: meals out, groceries, coffee, transport. */
function dailySpending(
	dayOfWeek: number,
	random: ReturnType<typeof stagingRandom>,
	add: Add,
): void {
	const { rnd, pick, between } = random;
	const ars = (title: string, amount: number, category: string) =>
		add({ title, amount, currency: "ARS", category });
	const weekend = dayOfWeek === 0 || dayOfWeek === 6;
	if (weekend && rnd() < 0.55) {
		const place = pick([
			"Parrilla Don Julio",
			"Pizzeria Guerrin",
			"Sushi Palermo",
			"Bar Sudestada",
		]);
		ars(place, between(18000, 72000, 500), "Restaurants");
	}
	if (dayOfWeek === 6 && rnd() < 0.8) {
		ars(
			pick(["Carrefour", "Dia", "Coto"]),
			between(35000, 110000, 100),
			"Groceries",
		);
	}
	if (!weekend && rnd() < 0.5) {
		ars(
			pick(["Cafe Havanna", "Lattente", "Cafe Martinez"]),
			between(4500, 9500, 100),
			"Cafe",
		);
	}
	if (!weekend && rnd() < 0.55) {
		ars("Recarga SUBE", between(5000, 15000, 500), "Transport");
	}
	if (rnd() < 0.05) ars("Uber", between(6000, 22000, 100), "Transport");
	if (rnd() < 0.07) {
		ars(
			pick(["PedidosYa", "Rappi"]),
			between(14000, 32000, 500),
			"Food Delivery",
		);
	}
	if (rnd() < 0.04) ars("Farmacity", between(8000, 45000, 100), "Health");
}

/** Sofía's own spending: ARS bills and daily life, plus USD subscriptions and gear. */
export function personalExpenses(anchor: Anchor): PersonalExpense[] {
	const random = stagingRandom();
	const out: PersonalExpense[] = [];
	for (let back = DAYS_OF_HISTORY; back >= 0; back--) {
		const add: Add = (e) => out.push({ ...e, back });
		const { year, month, day } = wallTime(
			daysAgo(anchor, back),
			SEED_TIME_ZONE,
		);
		for (const { day: due, ...bill } of MONTHLY_BILLS) {
			if (day === due) add(bill);
		}
		dailySpending(
			new Date(Date.UTC(year, month, day)).getUTCDay(),
			random,
			add,
		);
	}
	return [...out, ...ONE_OFFS];
}

/**
 * Florianópolis switched to manual approval this many days ago (the project's
 * "accept splits automatically" turned off mid-trip): entries before that
 * were auto-accepted, later ones wait for everyone but their author and Paz,
 * who has no account. That leaves Lucía's "Hospedagem, segunda casa" waiting
 * for Sofía's review.
 */
export const FLORIPA_MANUAL_SINCE_BACK = 34;

export interface SharedEntry {
	key: string;
	project: "floripa" | "depto" | null;
	description: string;
	amount: number;
	currency: "ARS" | "BRL" | "USD";
	category: string;
	back: number;
	paidBy: PersonKey;
	/** Who added it (Paz cannot: Sofía adds what Paz paid). Defaults to the payer. */
	createdBy?: PersonKey;
	with: readonly PersonKey[];
	/** SHARES units per person, in `with` order. Omitted means EQUAL. */
	units?: readonly number[];
}

const TRIP = ["sofia", "lucia", "martin", "paz"] as const;
const HOME = ["sofia", "martin"] as const;

/**
 * Florianópolis (BRL, about a month ago), Depto Palermo bills with Martín
 * (last month and this month) and direct splits with Lucía and Paz.
 */
// biome-ignore format: one row per entry reads as a table
export const SHARED_ENTRIES: readonly SharedEntry[] = [
	{ key: "fl_hospedagem", project: "floripa", description: "Hospedagem Barra da Lagoa", amount: 1800, currency: "BRL", category: "Travel", back: 40, paidBy: "sofia", with: TRIP },
	{ key: "fl_carro", project: "floripa", description: "Aluguel de carro", amount: 720, currency: "BRL", category: "Transport", back: 40, paidBy: "martin", with: TRIP },
	{ key: "fl_mercado", project: "floripa", description: "Mercado Praia", amount: 318, currency: "BRL", category: "Groceries", back: 39, paidBy: "paz", createdBy: "sofia", with: TRIP },
	{ key: "fl_uber_lagoa", project: "floripa", description: "Uber Lagoa", amount: 46.8, currency: "BRL", category: "Transport", back: 39, paidBy: "paz", createdBy: "sofia", with: TRIP },
	{ key: "fl_combustivel", project: "floripa", description: "Combustível", amount: 180, currency: "BRL", category: "Transport", back: 38, paidBy: "lucia", with: TRIP },
	{ key: "fl_barco", project: "floripa", description: "Passeio de barco", amount: 480, currency: "BRL", category: "Entertainment", back: 37, paidBy: "sofia", with: TRIP },
	{ key: "fl_uber_centro", project: "floripa", description: "Uber Centro", amount: 38.2, currency: "BRL", category: "Transport", back: 37, paidBy: "martin", with: ["sofia", "martin", "lucia"] },
	{ key: "fl_frutos", project: "floripa", description: "Frutos do mar", amount: 684.8, currency: "BRL", category: "Restaurants", back: 36, paidBy: "sofia", with: ["sofia", "lucia"] },
	{ key: "fl_ribeirao", project: "floripa", description: "Jantar no Ribeirão", amount: 925, currency: "BRL", category: "Restaurants", back: 35, paidBy: "martin", with: ["sofia", "martin"] },
	// The one trip Uber Sofía is not part of.
	{ key: "fl_uber_jurere", project: "floripa", description: "Uber Jurerê", amount: 52.9, currency: "BRL", category: "Transport", back: 35, paidBy: "lucia", with: ["lucia", "martin", "paz"] },
	{ key: "fl_segunda_casa", project: "floripa", description: "Hospedagem, segunda casa", amount: 620, currency: "BRL", category: "Travel", back: 34, paidBy: "lucia", with: ["sofia", "lucia", "paz"] },
	{ key: "fl_churrasco", project: "floripa", description: "Churrasco de despedida", amount: 780, currency: "BRL", category: "Restaurants", back: 32, paidBy: "sofia", with: TRIP, units: [2, 1, 1, 1] },
	{ key: "fl_uber_aeroporto", project: "floripa", description: "Uber Aeroporto", amount: 61.5, currency: "BRL", category: "Transport", back: 31, paidBy: "sofia", with: TRIP },
	{ key: "dp_wifi_prev", project: "depto", description: "Wifi y cable", amount: 113400, currency: "ARS", category: "Utilities", back: 50, paidBy: "martin", with: HOME },
	{ key: "dp_expensas_prev", project: "depto", description: "Expensas", amount: 93000, currency: "ARS", category: "Household", back: 44, paidBy: "sofia", with: HOME },
	{ key: "dp_luz_prev", project: "depto", description: "Electricidad", amount: 46800, currency: "ARS", category: "Utilities", back: 38, paidBy: "sofia", with: HOME },
	{ key: "dp_wifi", project: "depto", description: "Wifi y cable", amount: 113400, currency: "ARS", category: "Utilities", back: 20, paidBy: "martin", with: HOME },
	{ key: "dp_expensas", project: "depto", description: "Expensas", amount: 93000, currency: "ARS", category: "Household", back: 14, paidBy: "sofia", with: HOME },
	{ key: "dp_luz", project: "depto", description: "Electricidad", amount: 46800, currency: "ARS", category: "Utilities", back: 8, paidBy: "sofia", with: HOME },
	{ key: "dp_calefon", project: "depto", description: "Arreglo del calefón", amount: 108600, currency: "ARS", category: "Household", back: 2, paidBy: "martin", with: HOME },
	{ key: "dx_lolla", project: null, description: "Entradas Lollapalooza", amount: 80, currency: "USD", category: "Entertainment", back: 60, paidBy: "sofia", with: ["sofia", "lucia"] },
	{ key: "dx_seguro", project: null, description: "Seguro de viaje", amount: 96000, currency: "ARS", category: "Travel", back: 53, paidBy: "paz", createdBy: "sofia", with: ["sofia", "paz"] },
	{ key: "dx_pasajes", project: null, description: "Pasajes a Florianópolis", amount: 2040704, currency: "ARS", category: "Travel", back: 52, paidBy: "sofia", with: ["sofia", "paz"] },
	{ key: "dx_tigre", project: null, description: "Cabaña en Tigre", amount: 508600, currency: "ARS", category: "Travel", back: 45, paidBy: "sofia", with: ["sofia", "lucia"] },
	{ key: "dx_esquina", project: null, description: "Cena en La Esquina", amount: 64000, currency: "ARS", category: "Restaurants", back: 3, paidBy: "lucia", with: ["sofia", "lucia"] },
];

export interface SeedSettlement {
	key: string;
	from: PersonKey;
	to: PersonKey;
	amount: number;
	currency: "ARS" | "BRL" | "USD";
	back: number;
	project: "floripa" | "depto" | null;
	method: string;
	/** PROPOSED: recorded by the payer, waiting for the payee. */
	status: "FINALIZED" | "PROPOSED";
}

// biome-ignore format: one row per entry reads as a table
export const SETTLEMENTS: readonly SeedSettlement[] = [
	{ key: "lucia_usd", from: "lucia", to: "sofia", amount: 40, currency: "USD", back: 50, project: null, method: "Cash", status: "FINALIZED" },
	{ key: "paz_ars", from: "paz", to: "sofia", amount: 200000, currency: "ARS", back: 41, project: null, method: "Bank transfer", status: "FINALIZED" },
	{ key: "lucia_tigre", from: "lucia", to: "sofia", amount: 60000, currency: "ARS", back: 38, project: null, method: "Bank transfer", status: "FINALIZED" },
	{ key: "martin_depto", from: "martin", to: "sofia", amount: 13200, currency: "ARS", back: 30, project: "depto", method: "Mercado Pago", status: "FINALIZED" },
	{ key: "lucia_floripa", from: "lucia", to: "sofia", amount: 300, currency: "BRL", back: 28, project: "floripa", method: "Pix", status: "FINALIZED" },
	{ key: "lucia_cash", from: "lucia", to: "sofia", amount: 20000, currency: "ARS", back: 2, project: null, method: "Cash", status: "PROPOSED" },
];

export interface SeedAccount {
	key: string;
	name: string;
	type: "CASH" | "INVESTMENT" | "LIABILITY_CREDIT_CARD";
	currency: "ARS" | "USD";
	balance: number;
	isLiquid: boolean;
	card?: { interestRate: number; minimumPayment: number; dueDate: number };
}

// biome-ignore format: one row per entry reads as a table
export const ACCOUNTS: readonly SeedAccount[] = [
	{ key: "galicia", name: "Galicia (ARS)", type: "CASH", currency: "ARS", balance: 1840000, isLiquid: true },
	{ key: "mercadopago", name: "Mercado Pago (ARS)", type: "CASH", currency: "ARS", balance: 612000, isLiquid: true },
	{ key: "wise", name: "Wise (USD)", type: "CASH", currency: "USD", balance: 2350, isLiquid: true },
	{ key: "cash_usd", name: "Cash (USD)", type: "CASH", currency: "USD", balance: 800, isLiquid: true },
	{ key: "fci", name: "FCI Balanz Ahorro", type: "INVESTMENT", currency: "ARS", balance: 4200000, isLiquid: false },
	{ key: "visa", name: "Tarjeta Visa Galicia", type: "LIABILITY_CREDIT_CARD", currency: "ARS", balance: -486000, isLiquid: false, card: { interestRate: 118, minimumPayment: 40000, dueDate: 5 } },
];

/**
 * Month-start balances for the last six months, as in seed-demo-wealth.sql
 * but with a fixed wobble instead of hashtext(): assets grow toward today,
 * debts shrink toward today.
 */
export function historicBalance(
	account: SeedAccount,
	monthsBack: number,
	index: number,
): number {
	const wobble = ((index * 7 + monthsBack * 3) % 7) * 0.004;
	const factor =
		account.balance < 0
			? 1 + monthsBack * 0.035 + wobble
			: 1 - monthsBack * 0.045 + wobble;
	return account.balance * factor;
}

export interface SeedRecurring {
	key: string;
	name: string;
	amount: number;
	currency: "ARS" | "USD";
	category: string;
	/** Next due on this day of the month, or `overdueDays` before the anchor. */
	due: { dayOfMonth: number } | { overdueDays: number };
	autoPay: boolean;
}

// biome-ignore format: one row per entry reads as a table
export const RECURRING: readonly SeedRecurring[] = [
	{ key: "alquiler", name: "Alquiler depto", amount: 650000, currency: "ARS", category: "Rent", due: { dayOfMonth: 3 }, autoPay: true },
	{ key: "gimnasio", name: "Gimnasio Megatlon", amount: 62000, currency: "ARS", category: "Health", due: { dayOfMonth: 5 }, autoPay: false },
	{ key: "netflix", name: "Netflix", amount: 12.99, currency: "USD", category: "Subscriptions", due: { dayOfMonth: 15 }, autoPay: true },
	{ key: "spotify", name: "Spotify", amount: 4200, currency: "ARS", category: "Subscriptions", due: { dayOfMonth: 16 }, autoPay: true },
	{ key: "icloud", name: "iCloud 200GB", amount: 2.99, currency: "USD", category: "Subscriptions", due: { dayOfMonth: 18 }, autoPay: true },
	{ key: "tenis", name: "Cuota club de tenis", amount: 35000, currency: "ARS", category: "Hobby", due: { overdueDays: 2 }, autoPay: false },
];

/** Category budgets in ARS for this month and the two before it. */
export const BUDGETS: Readonly<Record<string, number>> = {
	Groceries: 380000,
	Restaurants: 220000,
	Cafe: 70000,
	"Food Delivery": 60000,
	Rent: 650000,
	Transport: 90000,
	Subscriptions: 40000,
	Health: 110000,
};

export const GLOBAL_BUDGET_ARS = 2100000;
export const MONTHLY_INCOME_ARS = 2600000;

/**
 * Gallery fixtures: static view models shaped exactly like the server's,
 * so every component renders here the way it renders on a page. Fixtures
 * live only under src/app/dev/components (the gallery); pages never import
 * them (IMPLEMENTATION §4, no fake data). Numbers mirror components.html.
 */
import { toMinor } from "@retrospend/domain/money-minor";
import type { MoneyValue } from "~/components/money/format";
import type {
	AccountVM,
	CategoryRef,
	EnvelopeVM,
	PersonVM,
	ProjectVM,
	RecurringVM,
	TransactionVM,
} from "~/components/rows/types";
import type { FacePerson } from "~/components/ui/avatar-face";

/** Money from a decimal string, through the domain's exact conversion. */
export const m = (amount: string, currency = "ARS"): MoneyValue => ({
	minor: toMinor(amount, currency),
	currency,
});

export const TODAY = "2026-10-21";

const cat = (name: string, icon: string, tone: number): CategoryRef => ({
	name,
	icon,
	tone,
});
export const CAT = {
	groceries: cat("Groceries", "ShoppingBasket", 1),
	restaurants: cat("Restaurants", "Utensils", 2),
	transport: cat("Transport", "Bus", 5),
	rent: cat("Rent", "Home", 7),
	utilities: cat("Utilities", "Zap", 8),
	internet: cat("Internet and phone", "Wifi", 9),
	subscriptions: cat("Subscriptions", "Repeat", 10),
	health: cat("Health", "HeartPulse", 11),
	home: cat("Home", "Lamp", 17),
	travel: cat("Travel", "Plane", 18),
} as const;

export const ME: FacePerson = { id: "me", name: "Sofía Ruiz", isSelf: true };
export const P = {
	lucia: { id: "lucia", name: "Lucía Fernández" },
	martin: { id: "martin", name: "Martín Acosta" },
	paz: { id: "paz", name: "Paz Ibarra" },
	juan: { id: "juan", name: "Juan Costa" },
	tomas: { id: "tomas", name: "Tomás Herrera" },
	camila: { id: "camila", name: "Camila Duarte" },
} satisfies Record<string, FacePerson>;

const tx = (
	o: Partial<TransactionVM> &
		Pick<TransactionVM, "id" | "title" | "amount" | "date">,
): TransactionVM => ({
	kind: "expense",
	category: CAT.groceries,
	reviewed: true,
	...o,
});

/** The desktop table rows (components.html, TransactionRow and Table). */
export const TABLE_ROWS: TransactionVM[] = [
	tx({
		id: "t1",
		title: "Azulejos de repuesto",
		category: CAT.home,
		amount: m("24000"),
		date: "2026-10-21",
	}),
	tx({
		id: "t2",
		title: "Consulta clínica",
		category: CAT.health,
		amount: m("62600"),
		date: "2026-10-20",
		reviewed: false,
	}),
	tx({
		id: "t3",
		title: "Almacén Los Álamos",
		amount: m("22000"),
		date: "2026-10-20",
	}),
	tx({
		id: "t4",
		title: "Arreglo del calefón",
		category: CAT.home,
		amount: m("108600"),
		share: m("54300"),
		date: "2026-10-20",
		project: { id: "p2", name: "Depto Palermo" },
		people: [P.martin, ME],
		payerId: "martin",
		payerName: "Martín",
	}),
	tx({
		id: "t5",
		title: "Uber",
		category: CAT.transport,
		amount: m("3400"),
		date: "2026-10-19",
		reviewed: false,
	}),
	tx({
		id: "t6",
		title: "Super Norte",
		amount: m("64000"),
		date: "2026-10-19",
	}),
	tx({
		id: "t7",
		title: "Cena en La Esquina",
		category: CAT.restaurants,
		amount: m("64000"),
		share: m("32000"),
		date: "2026-10-19",
		people: [P.lucia, ME],
		payerId: "lucia",
		payerName: "Lucía",
	}),
	tx({
		id: "t8",
		title: "Vivero Las Plantas",
		category: CAT.home,
		amount: m("12400"),
		share: m("6200"),
		date: "2026-10-19",
		reviewed: false,
		people: [ME, P.lucia],
		payerId: "me",
	}),
	tx({
		id: "t9",
		title: "Coto, compra del mes",
		amount: m("72400"),
		share: m("36200"),
		date: "2026-10-18",
		waiting: "review",
		project: { id: "p2", name: "Depto Palermo" },
		people: [P.martin, ME],
		payerId: "martin",
		payerName: "Martín",
	}),
];

/** Phone rows: unreviewed, USD, BRL, split, plain. */
export const PHONE_ROWS: TransactionVM[] = [
	tx({
		id: "ph1",
		title: "Consulta clínica",
		category: CAT.health,
		amount: m("62600"),
		date: "2026-10-20",
		reviewed: false,
	}),
	tx({
		id: "ph2",
		title: "CloudBox 200 GB",
		category: CAT.subscriptions,
		amount: m("2.99", "USD"),
		home: m("4213.09"),
		rateTip: "USD 1 = ARS 1,409 · Official · Oct 18",
		date: "2026-10-18",
		reviewed: false,
	}),
	tx({
		id: "ph3",
		title: "Churrasco de despedida",
		category: CAT.restaurants,
		amount: m("360.00", "BRL"),
		share: m("15676.20"),
		date: "2026-10-16",
		people: [P.lucia, ME, P.paz],
		payerId: "lucia",
	}),
	tx({
		id: "ph4",
		title: "Arreglo del calefón",
		category: CAT.home,
		amount: m("108600"),
		share: m("54300"),
		date: "2026-10-20",
		people: [P.martin, ME],
		payerId: "martin",
	}),
	tx({
		id: "ph5",
		title: "Pousada, última noche",
		category: CAT.travel,
		amount: m("736.00", "BRL"),
		share: m("96147.36"),
		date: "2026-10-15",
		people: [P.lucia, ME],
		payerId: "lucia",
	}),
	tx({
		id: "ph6",
		title: "Pago a Martín",
		kind: "payment",
		category: null,
		amount: m("50000"),
		date: "2026-10-20",
		pending: true,
	}),
];

export const PEOPLE: PersonVM[] = [
	{
		id: "lucia",
		name: "Lucía Fernández",
		onRetrospend: true,
		lastShared: "Cena en La Esquina, 2 days ago",
		balance: m("334460"),
		href: "#person",
	},
	{
		id: "martin",
		name: "Martín Acosta",
		onRetrospend: true,
		lastShared: "Arreglo del calefón, Depto Palermo, yesterday",
		balance: m("-172282"),
		href: "#person",
	},
	{
		id: "paz",
		name: "Paz Ibarra",
		onRetrospend: false,
		lastShared: "Churrasco de despedida, Viaje a Florianópolis, 4 days ago",
		balance: m("911430"),
		href: "#person",
	},
	{
		id: "juan",
		name: "Juan Costa",
		onRetrospend: false,
		lastShared: "Asado en lo de Juan, 3 weeks ago",
		balance: m("0"),
		href: "#person",
	},
	{
		id: "tomas",
		name: "Tomás Herrera",
		onRetrospend: true,
		lastShared: "Churrasco de despedida, Viaje a Florianópolis, 4 days ago",
		balance: m("201820"),
		href: "#person",
	},
	{
		id: "camila",
		name: "Camila Duarte",
		onRetrospend: false,
		lastShared: "Quincho y leña, Asado del Club, 9 days ago",
		balance: m("72683"),
		href: "#person",
	},
];

const project = (
	o: Partial<ProjectVM> & Pick<ProjectVM, "id" | "name">,
): ProjectVM => ({
	href: "#project",
	solo: false,
	people: [],
	peopleCount: 1,
	...o,
});
export const PROJECTS: ProjectVM[] = [
	project({
		id: "p1",
		name: "Viaje a Florianópolis",
		people: [P.lucia, P.martin, P.paz],
		peopleCount: 4,
		start: "2026-10-09",
		end: "2026-10-18",
		balance: m("700.40", "BRL"),
		budgetUsed: { basis: 9300, over: false },
	}),
	project({
		id: "p2",
		name: "Depto Palermo",
		people: [P.martin],
		peopleCount: 2,
		start: null,
		balance: m("-56700"),
	}),
	project({
		id: "p3",
		name: "Renovación cocina",
		solo: true,
		start: "2026-08-12",
		end: "2026-10-01",
		spent: m("2294000"),
		budgetUsed: { basis: 5100, over: false },
	}),
	project({
		id: "p4",
		name: "Asado del Club",
		people: [P.tomas, P.camila, P.lucia, P.paz],
		peopleCount: 5,
		start: null,
		balance: m("84683"),
	}),
	project({
		id: "p5",
		name: "Escapada a Mendoza",
		people: [P.lucia, P.tomas, P.camila],
		peopleCount: 4,
		start: "2026-11-13",
		end: "2026-11-16",
		spent: m("380000"),
		budgetUsed: { basis: 2900, over: false },
	}),
];

export const ACCOUNTS: AccountVM[] = [
	{
		id: "a3",
		name: "Cash (USD)",
		kind: "cash",
		amount: m("3200.00", "USD"),
		home: m("4697600"),
		updated: "2026-10-12",
		change: 60,
	},
	{
		id: "a7",
		name: "Bitcoin",
		kind: "crypto",
		amount: m("0.01834217", "BTC"),
		home: m("1735169.28"),
		updated: "2026-10-12",
		change: -220,
	},
	{
		id: "a8",
		name: "Ethereum",
		kind: "crypto",
		amount: m("0.0042", "ETH"),
		home: m("15834"),
		updated: "2026-10-12",
		change: 110,
	},
	{
		id: "a10",
		name: "Credit card",
		kind: "liability",
		amount: m("-842600"),
		updated: "2026-10-12",
	},
];

export const ENVELOPES: EnvelopeVM[] = [
	{
		id: "n4",
		name: "Rent",
		category: CAT.rent,
		available: m("0"),
		status: "funded",
		spent: 10000,
	},
	{
		id: "n5",
		name: "Utilities",
		category: CAT.utilities,
		available: m("10100"),
		status: "funded",
		spent: 8800,
	},
	{
		id: "n6",
		name: "Internet and phone",
		category: CAT.internet,
		available: m("57800"),
		status: "funded",
		spent: 5600,
	},
	{
		id: "n7",
		name: "Subscriptions",
		category: CAT.subscriptions,
		available: m("580"),
		status: "funded",
		spent: 9800,
	},
	{
		id: "n2",
		name: "Restaurants",
		category: CAT.restaurants,
		available: m("48400"),
		status: "overspent",
		spent: 10000,
	},
	{
		id: "n8",
		name: "Health",
		category: CAT.health,
		available: m("43200"),
		status: "underfunded",
		spent: 4100,
	},
];

export const RECURRING: RecurringVM[] = [
	{
		id: "r2",
		title: "Fibra e internet",
		category: CAT.internet,
		frequency: "monthly",
		next: "2026-10-08",
		state: "overdue",
		direction: "out",
		amount: m("38900"),
	},
	{
		id: "r5",
		title: "Streamly",
		category: CAT.subscriptions,
		frequency: "monthly",
		next: "2026-10-21",
		state: "due",
		direction: "out",
		amount: m("19225"),
	},
	{
		id: "r1",
		title: "Alquiler, mi parte",
		category: CAT.rent,
		frequency: "monthly",
		next: "2026-11-05",
		state: "upcoming",
		direction: "out",
		amount: m("650000"),
	},
	{
		id: "r7",
		title: "CloudBox 200 GB",
		category: CAT.subscriptions,
		frequency: "monthly",
		next: "2026-11-18",
		state: "upcoming",
		direction: "out",
		amount: m("2.99", "USD"),
		home: null,
	},
];

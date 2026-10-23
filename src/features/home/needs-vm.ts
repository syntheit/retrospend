/**
 * home.needsYou items to the kit's NeedsYouItemVM. The server sends facts
 * (type, entity, people, amount, date); this picks the kit kind, the one
 * context line and where a link goes. Amounts pass through untouched (R9).
 */
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import type {
	NeedsYouItem,
	NeedsYouList,
} from "~/server/services/needs-you/types";

/** Context lines Home words; the caller translates and formats dates. */
export type ContextKey =
	| "wasDue"
	| "paidOn"
	| "yourShare"
	| "dueOn"
	| "arrived"
	| "firstExpense"
	| "homeCurrency"
	| "importStatement";

export type Words = {
	context: (key: ContextKey, values?: Record<string, string>) => string;
	/** "Oct 8". */
	short: (iso: string) => string;
	/** The first name of a person in the list's faces. */
	name: (key: string) => string;
	/** The signed-in address, for Verify your email. */
	email: string | null;
};

/** Audit id of an item's amount (scope = the item id). */
export const needsFigure = (id: string) => `needsYou.amount:${id}`;

const SETTINGS_CURRENCY = "/settings#preferences";

function base(item: NeedsYouItem) {
	return {
		id: item.id,
		...(item.amount ? { figure: needsFigure(item.id) } : {}),
	};
}

const firstPerson = (item: NeedsYouItem, w: Words) =>
	item.people[0] ? w.name(item.people[0]) : "";

/** One item, or null for a type the kit does not show yet (none today). */
export function toNeedsVM(item: NeedsYouItem, w: Words): NeedsYouItemVM | null {
	const b = base(item);
	const amount = item.amount;
	const date = item.date;
	switch (item.type) {
		case "recurring.overdue":
			return amount
				? {
						...b,
						kind: "overdue",
						title: item.title ?? "",
						amount,
						...(date
							? { context: w.context("wasDue", { date: w.short(date) }) }
							: {}),
					}
				: null;
		case "recurring.due":
			return amount
				? { ...b, kind: "due", title: item.title ?? "", amount }
				: null;
		case "payment.confirm":
			return amount
				? {
						...b,
						kind: "confirmPayment",
						person: firstPerson(item, w),
						amount,
						...(date
							? { context: w.context("paidOn", { date: w.short(date) }) }
							: {}),
					}
				: null;
		case "split.review":
			return amount
				? {
						...b,
						kind: "verify",
						person: firstPerson(item, w),
						title: item.title ?? "",
						amount,
						...(date
							? { context: w.context("yourShare", { date: w.short(date) }) }
							: {}),
					}
				: null;
		case "split.rejected":
			return amount
				? {
						...b,
						kind: "rejected",
						person: firstPerson(item, w),
						title: item.title ?? "",
						amount,
					}
				: null;
		case "import.review":
			return {
				...b,
				kind: "review",
				count: item.count ?? 0,
				href: item.entity ? `/import?job=${item.entity.id}` : "/import",
			};
		case "budget.giveJob": {
			if (!amount) return null;
			const src = item.sources[0];
			return {
				...b,
				kind: "assign",
				amount,
				figure: "budget.notPlannedYet",
				href: "/budget",
				...(src
					? {
							context: w.context("arrived", {
								title: src.title,
								date: w.short(src.date),
							}),
						}
					: {}),
			};
		}
		case "budget.overspent":
			if (!amount) return null;
			return item.count === 1 && item.title
				? {
						...b,
						kind: "overspent",
						envelope: item.title,
						amount,
						href: "/budget",
					}
				: {
						...b,
						kind: "overspentMany",
						count: item.count ?? 0,
						amount,
						href: "/budget",
					};
		case "budget.overAssigned":
			return amount
				? { ...b, kind: "overAssigned", amount, href: "/budget" }
				: null;
		case "budget.billDue":
			return amount
				? {
						...b,
						kind: "billDue",
						title: item.title,
						count: item.count ?? 1,
						amount,
						href: "/budget",
						...(date
							? { context: w.context("dueOn", { date: w.short(date) }) }
							: {}),
					}
				: null;
		case "budget.missingRate":
			return {
				...b,
				kind: "missingRate",
				currencies: [...item.currencies],
				href: "/currencies",
			};
		case "budget.startingMoney":
			return { ...b, kind: "startingMoney", href: "/budget" };
		case "setup.firstExpense":
			return { ...b, kind: "firstExpense", context: w.context("firstExpense") };
		case "setup.homeCurrency":
			return {
				...b,
				kind: "homeCurrency",
				context: w.context("homeCurrency"),
				href: SETTINGS_CURRENCY,
			};
		case "setup.verifyEmail":
			return {
				...b,
				kind: "verifyEmail",
				...(w.email ? { context: w.email } : {}),
			};
		case "setup.importStatement":
			return {
				...b,
				kind: "importStatement",
				context: w.context("importStatement"),
				href: "/import",
			};
		default:
			// Seams (catalog.ts SEAMS): no source produces them yet.
			return null;
	}
}

/** The list in the server's order, with the items the kit shows. */
export function toNeedsVMs(list: NeedsYouList, w: Words) {
	return list.items.flatMap((item) => {
		const vm = toNeedsVM(item, w);
		return vm ? [{ item, vm }] : [];
	});
}

/** Currencies a Needs you item already names (a fact appears once). */
export function namedRates(list: NeedsYouList): string[] {
	return list.items.flatMap((i) =>
		i.type === "budget.missingRate" ? [...i.currencies] : [],
	);
}

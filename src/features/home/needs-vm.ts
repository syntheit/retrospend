/**
 * home.needsYou items to the kit's NeedsYouItemVM. The server sends facts
 * (type, entity, people, amount, date); this picks the kit kind, the one
 * context line and where a link goes. Amounts pass through untouched (R9).
 */
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import type { FacePerson } from "~/components/ui/avatar-face";
import type {
	NeedsYouFace,
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
	| "importStatement"
	| "owedSince";

export type Words = {
	context: (key: ContextKey, values?: Record<string, string>) => string;
	/** "Oct 8". */
	short: (iso: string) => string;
	/** The first name of a person in the list's faces. */
	name: (key: string) => string;
	/** A person in the list's faces: their picture and whether they are on Retrospend. */
	person: (key: string) => NeedsYouFace | undefined;
	/** The signed-in address, for Verify your email. */
	email: string | null;
};

const SETTINGS_CURRENCY = "/settings#preferences";

/**
 * Item amounts carry no figure tag: the figures registry has no id for
 * them yet (People's Needs you is the same). Give it a job is the pool,
 * budget.notPlannedYet, and carries that id.
 */
function base(item: NeedsYouItem) {
	return { id: item.id };
}

const firstPerson = (item: NeedsYouItem, w: Words) =>
	item.people[0] ? w.name(item.people[0]) : "";

/** The face an item leads with when it is about a person (rule 8). */
function faceOf(item: NeedsYouItem, w: Words): { face?: FacePerson } {
	const key = item.people[0];
	const person = key ? w.person(key) : undefined;
	return key && person
		? { face: { id: key, name: person.name, imageUrl: person.imageUrl } }
		: {};
}

/**
 * Owed for 60 days: leads with their face. Remind goes to people on
 * Retrospend; anyone else opens their page, where Settle up and Forgive are.
 */
function owedAging(
	item: NeedsYouItem,
	b: { id: string },
	w: Words,
): NeedsYouItemVM | null {
	const key = item.people[0];
	if (!key) return null;
	const face = w.person(key);
	const [type, id] = key.split(":");
	return {
		...b,
		kind: "owedAging",
		person: firstPerson(item, w),
		amount: item.amount,
		...faceOf(item, w),
		...(item.date
			? { context: w.context("owedSince", { date: w.short(item.date) }) }
			: {}),
		...(face?.onRetrospend
			? { action: "remind" }
			: { action: "open", href: `/people/${type}/${id}` }),
	};
}

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
						...faceOf(item, w),
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
						...faceOf(item, w),
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
						...faceOf(item, w),
						title: item.title ?? "",
						amount,
						// The server's primary action (catalog: expense edit).
						...(item.actions[0] ? { action: item.actions[0].id } : {}),
					}
				: null;
		case "import.review":
			return {
				...b,
				kind: "review",
				count: item.count ?? 0,
				href: item.entity ? `/import?job=${item.entity.id}` : "/import",
			};
		case "split.fixRequested":
			return item.title
				? {
						...b,
						kind: "fixRequested",
						person: firstPerson(item, w),
						...faceOf(item, w),
						title: item.title,
					}
				: null;
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
		case "budget.sharesNeedEnvelope":
			return {
				...b,
				kind: "sharesNeedEnvelope",
				count: item.count ?? 0,
				href: "/budget",
			};
		case "people.owedAging":
			return owedAging(item, b, w);
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

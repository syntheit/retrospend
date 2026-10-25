/**
 * The Activity read (expense.listV2): one cursor-paginated list of every
 * entry you are part of, newest first. Personal expenses, your shares of
 * shared expenses and payments (one row per payment, MONEY-MOVES I4), money
 * in, refunds and own transfers (M1 direction and entry kind). Reimbursements
 * are a kind the filter takes with no rows until their table lands (2D).
 */

import type { Money } from "@retrospend/domain/money-minor";
import { z } from "zod";

export const ACTIVITY_KINDS = [
	"expense",
	"in",
	"refund",
	"transfer",
	"reimbursement",
	"payment",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * The category filter's id for "No category": spending and refunds with no
 * category (money in and own transfers never have one). It travels in
 * `categoryIds` and in the v1 filter's `cat=`, alone or beside real ids; the
 * contract package mirrors it (g2-mirrors.test.ts).
 */
export const NO_CATEGORY = "none";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A person as `<participantType>:<participantId>` (user, shadow, guest). */
const personKey = z
	.string()
	.max(80)
	.regex(/^(user|shadow|guest):[\w-]+$/);
const ids = z.array(z.string().min(1).max(64)).max(50);

export const listV2Input = z.object({
	from: isoDate.optional(),
	to: isoDate.optional(),
	/** Category ids; NO_CATEGORY also lists the rows that have none. */
	categoryIds: ids.optional(),
	projectIds: ids.optional(),
	people: z.array(personKey).max(50).optional(),
	/** "me" or a person key. */
	paidBy: z
		.array(z.union([z.literal("me"), personKey]))
		.max(50)
		.optional(),
	kinds: z.array(z.enum(ACTIVITY_KINDS)).max(ACTIVITY_KINDS.length).optional(),
	/** Matches titles, notes and amounts, ignoring case and accents (RC-10). */
	q: z.string().max(100).optional(),
	cursor: z.string().min(1).max(512).optional(),
	limit: z.number().int().min(1).max(200).default(50),
});
export type ListV2Input = z.input<typeof listV2Input>;
export type ListV2Filter = z.output<typeof listV2Input>;

/** A category as rows show it: the color is a category-n token number. */
export type CategoryRefDTO = {
	id: string | null;
	name: string | null;
	icon: string | null;
	tone: number;
};

export type PersonDTO = {
	/** The person key, `<type>:<id>`. */
	id: string;
	name: string;
	imageUrl: string | null;
	isSelf: boolean;
};

export type ActivityRowDTO = {
	/** Unique across sources: `<expense id>`, `shared:<id>`, `payment:<key>`. */
	id: string;
	source: "personal" | "shared" | "payment";
	/** The id the edit, delete and open actions take. */
	entityId: string;
	/** Money in reads "income"; a refund "refund"; own transfers (Not spending) "transfer". */
	kind: "expense" | "income" | "refund" | "transfer" | "payment";
	/** Empty for payments; the client words them from `payment`. */
	title: string;
	category: CategoryRefDTO | null;
	/** As entered (a shared expense: its full amount). */
	amount: Money;
	/** In the home currency when foreign; null: no rate yet. Absent: same currency. */
	home?: Money | null;
	/** Your share of a split, in the home currency when a rate exists. */
	share?: Money;
	/**
	 * The rate type a foreign personal row was booked at, set only when it is
	 * not the user's default for their home currency (GUIDELINE §7).
	 */
	rateType?: string;
	/** Home minor units for the amount column's sort; null without a rate. */
	sortKey: number | null;
	waiting?: "review" | "rejected";
	pending?: boolean;
	project: { id: string; name: string } | null;
	people?: PersonDTO[];
	payerId?: string;
	/** Set when someone other than you paid. */
	payerName?: string;
	/** ISO date in the viewer's time zone. */
	date: string;
	/** For the action registry. */
	mine: boolean;
	locked: boolean;
	canEdit: boolean;
	payment?: { direction: "sent" | "received"; counterparty: string };
};

export type ActivityTotalDTO = {
	/** The figures registry key the footer renders. */
	figure: string;
	value: Money;
};

export type ListV2Result = {
	items: ActivityRowDTO[];
	nextCursor: string | null;
	/** Today in the viewer's time zone. */
	today: string;
	homeCurrency: string;
	/** First page only: rows the filter matches in all pages. */
	count: number | null;
	/** First page only; null when spent() cannot express the filter or a rate is missing. */
	total: ActivityTotalDTO | null;
	/** Your spending per ISO day for the days on this page; null like `total`. */
	dayTotals: Record<string, Money> | null;
	/** Currencies whose missing rate kept `total` or `dayTotals` out ("Not available"). */
	missingRates: string[];
	/** First page with no rows only: whether rows match outside the dates. */
	elsewhere: boolean | null;
};

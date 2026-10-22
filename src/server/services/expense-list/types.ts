/**
 * The Activity read (expense.listV2): one cursor-paginated list of every
 * entry you are part of, newest first. Personal expenses, your shares of
 * shared expenses and payments (one row per payment, MONEY-MOVES I4). Money
 * in, refunds, transfers and reimbursements are kinds the filter already
 * takes; they have no rows until their tables land (2A, 2D).
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
	kind: "expense" | "payment";
	/** Empty for payments; the client words them from `payment`. */
	title: string;
	category: CategoryRefDTO | null;
	/** As entered (a shared expense: its full amount). */
	amount: Money;
	/** In the home currency when foreign; null: no rate yet. Absent: same currency. */
	home?: Money | null;
	/** Your share of a split, in the home currency when a rate exists. */
	share?: Money;
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
	canDelete: boolean;
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
	/** First page only; null when spent() cannot express the filter or is unavailable. */
	total: ActivityTotalDTO | null;
};

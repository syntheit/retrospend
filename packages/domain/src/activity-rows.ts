/**
 * The pure half of an Activity row: the DTO one expense, one of your shares of
 * a shared expense or one payment becomes (Money in minor units, the home
 * value, the rate type, who paid, what you may do), from the stored rows a
 * loader hands in. The server loads them with SQL
 * (server/services/expense-list/rows.ts); a device selects them from its own
 * store (activity-rows-store.ts). Both feed activityRowsFrom, so the list, the
 * read view, the entry figures and the API cannot disagree, and a pg test
 * holds the two loaders to each other.
 *
 * Home values follow the totals rule: a row booked in the home currency keeps
 * its booked value, others use today's home rate (`rates`); a missing rate
 * gives null, never a rate of 1.
 */
import { type RateRow, rateLookup, USD } from "./money";
import type { Money } from "./money-minor";
import type { DecimalInput } from "./precise-decimal";
import { dec } from "./precise-decimal";
import { deriveCanModify } from "./project-roles";
import {
	type CategoryRefDTO,
	categoryRef,
	decimalMoney,
	type HomeRates,
	homeFromUSD,
	homeOf,
	numberOf,
} from "./row-money";
import { dayKey } from "./time-zone";

export type { CategoryRefDTO };

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
	/** With `rateType`: the rate it was booked at, home per 1 unit of the amount's currency, unrounded. */
	rate?: string;
	/** Home minor units for the amount column's sort; null without a rate. */
	sortKey: number | null;
	waiting?: "review" | "rejected";
	/**
	 * Set on an expense or refund the list shows and the footer and day
	 * totals leave out: hidden from reports, or filed under an income
	 * category. The row says so (a rejected share says Rejected through
	 * `waiting`).
	 */
	notCounted?: boolean;
	/**
	 * Set on an amortized purchase: it is counted, through its monthly parts,
	 * which the list hides and the totals place on their own days. The row
	 * says "Spread over N months", never "Not counted".
	 */
	spread?: { months: number };
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

/** Names and faces for person keys. */
export type Who = { name: string; imageUrl: string | null };

/** The name rows use for a payer or the other side of a payment ("Martín paid"). */
export const firstName = (who: Who | undefined) =>
	who?.name.trim().split(/\s+/)[0] ?? "";

export const personKeyOf = (type: string, id: string) => `${type}:${id}`;

/**
 * The rate a row was booked at, unrounded: units of `homeCurrency` per 1 unit
 * of the row's currency (homeRate, 12 decimals), when it was booked in
 * `homeCurrency`. Clients word it with formatRate; null when no rate was
 * booked in that home.
 */
export function bookedRate(
	row: { homeCurrency: string | null; homeRate: DecimalInput | null },
	homeCurrency: string,
): string | null {
	if (row.homeCurrency !== homeCurrency || row.homeRate === null) return null;
	return dec(row.homeRate).toString();
}

/** Which table a row key reads: your expense (p), a shared expense (s) or a payment (g). */
export type RowKey = { src: "p" | "s" | "g"; id: string };

const SHARED = "shared:";
const PAYMENT = "payment:";

/** The key of the row an entry id names: a personal expense id, `shared:<id>` or `payment:<key>`. */
export function rowKeyFromEntryId(entryId: string): RowKey {
	if (entryId.startsWith(SHARED))
		return { src: "s", id: entryId.slice(SHARED.length) };
	if (entryId.startsWith(PAYMENT))
		return { src: "g", id: entryId.slice(PAYMENT.length) };
	return { src: "p", id: entryId };
}

/** Splits a payment key `<group or settlement id>|<currency>`. */
export function splitPaymentKey(key: string) {
	const at = key.lastIndexOf("|");
	return { group: key.slice(0, at), currency: key.slice(at + 1) };
}

/** A category with what shaping reads: its kind and, for a shared expense, whose it is. */
export interface ActivityCategory {
	id: string;
	userId: string;
	name: string;
	color: string;
	icon: string | null;
	kind: string;
}

/** One of your expenses as stored, with its category and how many monthly parts it was spread into. */
export interface PersonalRowInput {
	id: string;
	direction: "OUT" | "IN";
	entryKind: string;
	inType: string | null;
	title: string;
	amount: DecimalInput;
	currency: string;
	amountInUSD: DecimalInput;
	/** Home value booked when saved (M2): it never moves with the rate. */
	homeCurrency: string | null;
	homeAmount: DecimalInput | null;
	homeRate: DecimalInput | null;
	rateType: string | null;
	date: Date;
	excludeFromAnalytics: boolean;
	isAmortizedParent: boolean;
	category: ActivityCategory | null;
	childCount: number;
}

/** One of your split rows with the shared expense it belongs to. */
export interface SharedRowInput {
	shareAmount: DecimalInput;
	verificationStatus: string;
	transaction: {
		id: string;
		description: string;
		amount: DecimalInput;
		currency: string;
		/** Rate captured when saved (units per USD), or null. */
		exchangeRate: DecimalInput | null;
		date: Date;
		paidByType: string;
		paidById: string;
		createdByType: string;
		createdById: string;
		isLocked: boolean;
		projectId: string | null;
		project: { id: string; name: string } | null;
		category: ActivityCategory | null;
		splitParticipants: { participantType: string; participantId: string }[];
	};
}

/** One settlement row of a payment (a payment may be several, one per project). */
export interface PaymentRowInput {
	id: string;
	paymentGroupId: string | null;
	currency: string;
	amount: DecimalInput;
	status: string;
	initiatedAt: Date;
	fromParticipantType: string;
	fromParticipantId: string;
	toParticipantType: string;
	toParticipantId: string;
	project: { id: string; name: string } | null;
}

/** Everything a page of rows reads, as loaders hand it to activityRowsFrom. */
export interface ActivityRowInputs {
	personal: PersonalRowInput[];
	shares: SharedRowInput[];
	payments: PaymentRowInput[];
	/** Names and faces of the people on the shared rows and payments. */
	who: Record<string, Who>;
	/** `projectId -> highest role` of the caller across the shared rows' projects. */
	roles: Record<string, string>;
	/** Every rate row of the currencies activityRateCurrencies names. */
	rateRows: Record<string, RateRow[]>;
}

export type ShapeContext = {
	userId: string;
	timeZone: string | undefined;
	rates: HomeRates;
	/** The user's default rate type into their home currency; rows name any other. */
	defaultRateType?: string | null;
};

/**
 * The currencies whose rate rows shaping reads: a shared expense without a
 * captured rate and every payment, priced at their own dates.
 */
export function activityRateCurrencies(rows: {
	shares: readonly SharedRowInput[];
	payments: readonly PaymentRowInput[];
}): string[] {
	return [
		...new Set([
			...rows.shares
				.filter((s) => s.transaction.exchangeRate === null)
				.map((s) => s.transaction.currency),
			...rows.payments.map((p) => p.currency),
		]),
	].filter((c) => c !== USD);
}

/** The home value only when it differs from the amount's currency. */
function homeField(
	currency: string,
	home: ActivityRowDTO["home"],
	rates: HomeRates,
) {
	return currency === rates.home ? {} : { home };
}

/**
 * Why the footer and day totals leave a personal row out, as the row says
 * it. spent() counts spending and refunds except these: a row hidden from
 * reports and a row filed under an income category are "Not counted"; an
 * amortized purchase is counted through its monthly parts, which the list
 * hides, so the parent says it is "Spread over N months" instead. Money in
 * and transfers add nothing either way, so they say nothing.
 */
function leftOut(
	e: PersonalRowInput,
	kind: ActivityRowDTO["kind"],
): Pick<ActivityRowDTO, "notCounted" | "spread"> {
	if (kind !== "expense" && kind !== "refund") return {};
	// Parts inherit the parent's hiding and category: nothing is counted then.
	if (e.excludeFromAnalytics || e.category?.kind === "INCOME")
		return { notCounted: true };
	if (!e.isAmortizedParent) return {};
	return e.childCount > 0
		? { spread: { months: e.childCount } }
		: { notCounted: true };
}

/** How a personal row reads: money in, a refund, an own transfer or spending. */
function personalKind(e: PersonalRowInput): ActivityRowDTO["kind"] {
	if (e.entryKind === "NOT_SPENDING") return "transfer";
	if (e.direction === "IN") return e.inType === "REFUND" ? "refund" : "income";
	return "expense";
}

function personalRow(e: PersonalRowInput, c: ShapeContext): ActivityRowDTO {
	const amount = decimalMoney(e.amount, e.currency);
	const foreign = e.currency !== c.rates.home;
	// A home value booked at save (M2) never moves; others use today's rate.
	const home = !foreign
		? amount
		: e.homeCurrency === c.rates.home && e.homeAmount !== null
			? decimalMoney(e.homeAmount, c.rates.home)
			: homeFromUSD(numberOf(e.amountInUSD), c.rates);
	// A type is named only with its number: no booked rate, no type.
	const bookedAt = foreign ? bookedRate(e, c.rates.home) : null;
	const named =
		foreign &&
		e.rateType !== null &&
		e.rateType !== c.defaultRateType &&
		bookedAt !== null;
	const kind = personalKind(e);
	return {
		id: e.id,
		source: "personal",
		entityId: e.id,
		kind,
		title: e.title,
		category: categoryRef(e.category),
		amount,
		...homeField(e.currency, home, c.rates),
		...(named && e.rateType && bookedAt
			? { rateType: e.rateType, rate: bookedAt }
			: {}),
		sortKey: home?.minor ?? null,
		...leftOut(e, kind),
		project: null,
		date: dayKey(e.date, c.timeZone),
		mine: true,
		locked: false,
		canEdit: true,
	};
}

/**
 * Everyone in a split, the payer included. RLS hides the other split rows
 * of a standalone expense from a participant who did not create it (only
 * the creator, project members and each person's own row are visible), so
 * the payer, always on the transaction itself, is added when missing.
 */
function peopleOf(t: SharedRowInput["transaction"], payerId: string): string[] {
	const keys = t.splitParticipants.map((s) =>
		personKeyOf(s.participantType, s.participantId),
	);
	return keys.includes(payerId) ? keys : [payerId, ...keys];
}

type Lookup = ReturnType<typeof rateLookup>;

function sharedRow(
	{ transaction: t, shareAmount, verificationStatus }: SharedRowInput,
	x: {
		c: ShapeContext;
		who: Readonly<Record<string, Who>>;
		roles: ReadonlyMap<string, string>;
		lookup: Lookup;
	},
): ActivityRowDTO {
	const me = personKeyOf("user", x.c.userId);
	const rate =
		t.currency === USD
			? 1
			: t.exchangeRate !== null
				? numberOf(t.exchangeRate)
				: (x.lookup(t.currency, t.date)?.rate ?? null);
	const home = homeOf(numberOf(t.amount), t.currency, rate, x.c.rates);
	const share =
		homeOf(numberOf(shareAmount), t.currency, rate, x.c.rates) ??
		decimalMoney(shareAmount, t.currency);
	const payerId = personKeyOf(t.paidByType, t.paidById);
	const mine = t.createdByType === "user" && t.createdById === x.c.userId;
	const face = (key: string): PersonDTO => ({
		id: key,
		name: x.who[key]?.name ?? "",
		imageUrl: x.who[key]?.imageUrl ?? null,
		isSelf: key === me,
	});
	const waiting =
		verificationStatus === "REJECTED"
			? "rejected"
			: verificationStatus === "PENDING" && !mine
				? "review"
				: null;
	return {
		id: `shared:${t.id}`,
		source: "shared",
		entityId: t.id,
		kind: "expense",
		title: t.description,
		// Another person's category is not usable here (D19): spent() and Insights
		// count the share as No category, so the row shows none too.
		category:
			t.category?.userId === x.c.userId ? categoryRef(t.category) : null,
		amount: decimalMoney(t.amount, t.currency),
		...homeField(t.currency, home, x.c.rates),
		share,
		sortKey: home?.minor ?? null,
		...(waiting ? { waiting } : {}),
		project: t.project,
		people: peopleOf(t, payerId).map(face),
		payerId,
		...(payerId === me ? {} : { payerName: firstName(x.who[payerId]) }),
		date: dayKey(t.date, x.c.timeZone),
		mine,
		locked: t.isLocked,
		canEdit: deriveCanModify({
			isLocked: t.isLocked,
			projectId: t.projectId,
			isCreator: mine,
			roleMap: x.roles,
		}),
	};
}

function paymentRow(
	key: string,
	group: PaymentRowInput[],
	first: PaymentRowInput,
	x: {
		c: ShapeContext;
		who: Readonly<Record<string, Who>>;
		lookup: Lookup;
	},
): ActivityRowDTO {
	const me = personKeyOf("user", x.c.userId);
	const from = personKeyOf(first.fromParticipantType, first.fromParticipantId);
	const to = personKeyOf(first.toParticipantType, first.toParticipantId);
	const sent = from === me;
	const total = group.reduce((s, r) => s.plus(dec(r.amount)), dec(0));
	const amount = decimalMoney(total, first.currency);
	const rate = x.lookup(first.currency, first.initiatedAt)?.rate ?? null;
	const home = homeOf(numberOf(total), first.currency, rate, x.c.rates);
	const projects = new Map(
		group.flatMap((r) => (r.project ? [[r.project.id, r.project]] : [])),
	);
	return {
		id: `payment:${key}`,
		source: "payment",
		entityId: key.slice(0, key.lastIndexOf("|")),
		kind: "payment",
		title: "",
		category: null,
		amount,
		...homeField(first.currency, home, x.c.rates),
		sortKey: home?.minor ?? null,
		...(group.some((r) => r.status === "PROPOSED") ? { pending: true } : {}),
		project: projects.size === 1 ? ([...projects.values()][0] ?? null) : null,
		date: dayKey(
			new Date(Math.min(...group.map((r) => r.initiatedAt.getTime()))),
			x.c.timeZone,
		),
		mine: sent,
		locked: true,
		canEdit: false,
		payment: {
			direction: sent ? "sent" : "received",
			counterparty: firstName(x.who[sent ? to : from]),
		},
	};
}

/**
 * The DTOs for a page of keys, in the keys' order, from the rows a loader read
 * for them. A key with no row (not yours, gone) gives none.
 */
export function activityRowsFrom(
	keys: readonly RowKey[],
	inputs: ActivityRowInputs,
	c: ShapeContext,
): ActivityRowDTO[] {
	const lookup = rateLookup(inputs.rateRows);
	const roles = new Map(Object.entries(inputs.roles));
	const byId = new Map<string, ActivityRowDTO>();
	for (const e of inputs.personal) byId.set(`p|${e.id}`, personalRow(e, c));
	for (const s of inputs.shares) {
		const row = sharedRow(s, { c, who: inputs.who, roles, lookup });
		byId.set(`s|${row.entityId}`, row);
	}
	const byGroup = new Map<string, PaymentRowInput[]>();
	for (const r of inputs.payments) {
		const key = `${r.paymentGroupId ?? r.id}|${r.currency}`;
		byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
	}
	for (const [key, group] of byGroup) {
		const first = group[0];
		if (first)
			byId.set(
				`g|${key}`,
				paymentRow(key, group, first, { c, who: inputs.who, lookup }),
			);
	}
	return keys.flatMap((k) => {
		const row = byId.get(`${k.src}|${k.id}`);
		return row ? [row] : [];
	});
}

/** The one row an entry id names (an entry figure reads), or null when it is not there or not yours. */
export function entryRowFrom(
	entryId: string,
	inputs: ActivityRowInputs,
	c: ShapeContext,
): ActivityRowDTO | null {
	return activityRowsFrom([rowKeyFromEntryId(entryId)], inputs, c)[0] ?? null;
}

/** entry.amount: the row's amount in its own currency. */
export const entryAmountOf = (row: ActivityRowDTO | null): Money[] =>
	row ? [row.amount] : [];

/** entry.share: your share of a shared expense; none for any other row. */
export const entryShareOf = (row: ActivityRowDTO | null): Money[] =>
	row?.share ? [row.share] : [];

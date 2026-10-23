/**
 * Hand-made split rows for the P3 scenario tests, in the shapes the loader
 * reads from Postgres, run through the same pure path as getMonth:
 * buildSplits (routing, categories, events, replay), activityEntries,
 * computeBook and buildMonthView.
 */
import { Prisma } from "~prisma";
import {
	type ActivityEntry,
	computeBook,
	type EngineInput,
	type MoneyInEntry,
} from "../engine";
import { activityEntries, Valuer } from "../entries";
import { invariantSides } from "../invariant";
import { buildMonthView, type ViewBook } from "../month-view";
import { owedSummary } from "../owed";
import type { SettlementRowIn, SplitPart } from "../split-events";
import { buildSplits, type MyShare, type RouteRow } from "../splits-input";
import { bookContext, lookupIn, RATES } from "../test-fixtures";
import type { IsoDate, MonthKey } from "../types";

/** The fixture rates plus CLP (960 per USD), which the trip scenarios need. */
export const TABLE = {
	...RATES,
	CLP: { official: [["2026-01-01", "960"]] },
} as typeof RATES;

const D = (v: string | number) => new Prisma.Decimal(v);
const at = (date: IsoDate) => new Date(`${date}T12:00:00Z`);
const party = (key: string) => {
	const [type, id] = key.split(":") as [SplitPart["participantType"], string];
	return { participantType: type, participantId: id };
};

export interface TxSpec {
	id: string;
	currency: string;
	date: IsoDate;
	/** "user:me", "user:sam", "guest:mateo"... */
	paidBy: string;
	projectId?: string | null;
	/** The creator's category. */
	category?: { id: string; name: string; owner: string } | null;
}

function txOf(t: TxSpec) {
	const payer = party(t.paidBy);
	return {
		id: t.id,
		currency: t.currency,
		date: at(t.date),
		categoryId: t.category?.id ?? null,
		exchangeRate: null,
		projectId: t.projectId ?? null,
		paidByType: payer.participantType,
		paidById: payer.participantId,
		category: t.category
			? { userId: t.category.owner, name: t.category.name }
			: null,
	};
}

/** Your own share of a split (the share definition already left out rejected ones). */
export function mine(
	id: string,
	t: TxSpec,
	share: string,
	extra: {
		status?: "PENDING" | "ACCEPTED" | "REJECTED";
		categoryId?: string | null;
		source?: MyShare["categorySource"];
	} = {},
): MyShare {
	return {
		id,
		participantType: "user",
		participantId: "me",
		shareAmount: D(share),
		verificationStatus: extra.status ?? "ACCEPTED",
		categoryId: extra.categoryId ?? null,
		categorySource: extra.categoryId ? (extra.source ?? "USER") : null,
		transaction: txOf(t),
	} as MyShare;
}

/** Someone else's share of a split you paid. */
export function front(
	id: string,
	who: string,
	t: TxSpec,
	share: string,
	status: "PENDING" | "ACCEPTED" | "REJECTED" = "ACCEPTED",
): SplitPart {
	return {
		id,
		...party(who),
		shareAmount: D(share),
		verificationStatus: status,
		transaction: txOf(t),
	};
}

export function settlement(
	id: string,
	from: string,
	to: string,
	amount: string,
	currency: string,
	paidOn: IsoDate,
	extra: Partial<SettlementRowIn> & { converted?: [string, string] } = {},
): SettlementRowIn {
	const { converted, ...rest } = extra;
	return {
		id,
		fromParticipantType: party(from).participantType,
		fromParticipantId: party(from).participantId,
		toParticipantType: party(to).participantType,
		toParticipantId: party(to).participantId,
		amount: D(amount),
		currency,
		convertedAmount: converted ? D(converted[0]) : null,
		convertedCurrency: converted ? converted[1] : null,
		status: "FINALIZED",
		kind: "PAYMENT",
		isOffset: false,
		confirmedByPayer: true,
		confirmedByPayee: true,
		settledAt: at(paidOn),
		initiatedAt: at(paidOn),
		projectId: null,
		forgiveEnvelopeId: null,
		payment: { paidOn: new Date(`${paidOn}T00:00:00Z`) },
		...rest,
	};
}

export interface SplitScenario {
	currency: string;
	/** The book's rate type for foreign rows (ARS books use blue). */
	rateType?: string;
	start: MonthKey;
	current: MonthKey;
	today: IsoDate;
	envelopes: Array<{ id: string; cats?: string[] }>;
	defaultEnvelope: string;
	moneyIn?: MoneyInEntry[];
	spending?: ActivityEntry[];
	mine?: MyShare[];
	fronts?: SplitPart[];
	settlements?: SettlementRowIn[];
	routes?: RouteRow[];
	categories?: Array<{ id: string; name: string }>;
}

export function runSplits(s: SplitScenario) {
	const rateType = s.rateType ?? "official";
	const ctx = bookContext(s.currency, {
		usdRate: lookupIn(TABLE),
		defaultRateType: rateType,
		periods: [{ fromMonth: s.start, startDay: 1, rateType }],
	});
	const valuer = new Valuer(ctx, "UTC", [{ fromMonth: s.start, startDay: 1 }]);
	const table = lookupIn(TABLE);
	const splits = buildSplits(
		{
			routes: s.routes ?? [],
			mine: s.mine ?? [],
			fronts: s.fronts ?? [],
			settlements: s.settlements ?? [],
			categories: s.categories ?? [],
		},
		{
			userId: "me",
			valuer,
			startMonth: s.start,
			key: (r) => `${r.participantType}:${r.participantId}`,
			// The share's own rate, else the official table rate on its date.
			rate: (row) =>
				row.exchangeRate
					? String(row.exchangeRate)
					: (table(
							row.currency,
							"official",
							row.date.toISOString().slice(0, 10),
						)?.toString() ?? null),
		},
	);
	const input: EngineInput = {
		startMonth: s.start,
		currentMonth: s.current,
		defaultEnvelopeId: s.defaultEnvelope,
		envelopes: s.envelopes.map((e) => ({
			id: e.id,
			kind: "MONTHLY",
			leftoverRule: "CARRY",
			sweepToId: null,
			categoryIds: e.cats ?? [],
		})),
		moneyIn: s.moneyIn ?? [],
		activity: [
			...(s.spending ?? []),
			...activityEntries(
				{
					spending: [],
					refunds: [],
					shares: splits.shares,
					shareRate: splits.shareRate,
				},
				valuer,
				splits.routing,
			),
		],
		movements: [],
		splits: splits.replay.effects,
	};
	const book: ViewBook = {
		id: "book",
		style: "FLEX",
		fundingSource: "INCOME",
		currency: s.currency,
		startMonth: s.start,
		weekStartDay: 1,
		periods: [{ fromMonth: s.start, startDay: 1 }],
		defaultEnvelopeId: s.defaultEnvelope,
		groups: [{ id: "spending", name: "spending", role: "SPENDING", order: 0 }],
		envelopes: s.envelopes.map((e, order) => ({
			id: e.id,
			name: e.id,
			icon: null,
			color: null,
			kind: "MONTHLY",
			groupId: "spending",
			order,
			categoryIds: e.cats ?? [],
			archived: false,
			target: null,
			targetStartMonth: null,
			foreign: null,
			targetIncomplete: false,
		})),
	};
	const state = computeBook(input);
	const owedInput = {
		replay: splits.replay,
		events: splits.events,
		pending: splits.pending,
		notInBudget: splits.notInBudget,
		currency: s.currency,
		today: s.today,
		incomplete: valuer.missingRates.length > 0,
	};
	const view = buildMonthView({
		book,
		input,
		state,
		month: s.current,
		today: s.today,
		missingRates: valuer.missingRates,
		owed: owedSummary(owedInput),
	}).dto;
	return {
		splits,
		input,
		view,
		owedInput,
		missingRates: valuer.missingRates,
		sides: invariantSides(input, state),
		left: (id: string) =>
			view.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)?.left
				.minor,
		balance: (who: string, currency: string) =>
			splits.replay.balances.find(
				(b) => b.counterparty === who && b.currency === currency,
			)?.native ?? 0,
	};
}

let seq = 0;
export const income = (month: MonthKey, minor: number): MoneyInEntry => ({
	id: `in${++seq}`,
	month,
	minor,
	source: "INCOME",
});

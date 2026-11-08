/**
 * The device loader of Activity rows: the same inputs the server loader reads
 * with SQL (server/services/expense-list/rows.ts), selected from the rows a
 * device holds. The rules are the JS twins of that SQL: your own expenses by
 * id, your split rows of the page's shared expenses, and payments by group
 * that are payments (not offsets), not rejected and between you and someone.
 * activityRowsFrom shapes the result, and a pg test holds the two loaders to
 * each other.
 */
import { rateRowsByCurrency, type StoredRateRow } from "./money";
import {
	type ActivityCategory,
	type ActivityRowInputs,
	activityRateCurrencies,
	type PaymentRowInput,
	type PersonalRowInput,
	personKeyOf,
	type RowKey,
	type SharedRowInput,
	splitPaymentKey,
	type Who,
} from "./activity-rows";
import { strongestRoles } from "./project-roles";

/** An expense as stored: the shaped fields, its owner and where it hangs. */
export type StoredExpense = Omit<PersonalRowInput, "category" | "childCount"> & {
	userId: string;
	categoryId: string | null;
	/** Set on a monthly part of an amortized purchase. */
	parentId: string | null;
};

/** A shared expense as stored, without its people. */
export type StoredSharedTransaction = Omit<
	SharedRowInput["transaction"],
	"project" | "category" | "splitParticipants"
> & { categoryId: string | null };

/** A settlement as stored: a payment, an offset or another kind. */
export type StoredSettlement = PaymentRowInput & {
	isOffset: boolean;
	kind: string;
};

/** The rows a device holds, as they sync down (what RLS lets this user read). */
export interface ActivityStore {
	userId: string;
	expenses: readonly StoredExpense[];
	categories: readonly ActivityCategory[];
	/** Split rows of shared expenses, anyone's. */
	splits: readonly {
		transactionId: string;
		participantType: string;
		participantId: string;
		shareAmount: SharedRowInput["shareAmount"];
		verificationStatus: string;
	}[];
	transactions: readonly StoredSharedTransaction[];
	projects: readonly { id: string; name: string }[];
	settlements: readonly StoredSettlement[];
	memberships: readonly {
		projectId: string;
		participantType: string;
		participantId: string;
		role: string;
	}[];
	/** Names and faces by person key (`<type>:<id>`). */
	people: Readonly<Record<string, Who>>;
	/** Every rate row held, any currency, date and type. */
	rateRows: readonly StoredRateRow[];
}

/** The inputs for a page of keys from rows held in memory: what a device loader returns. */
export function activityInputsFromRows(
	store: ActivityStore,
	keys: readonly RowKey[],
): ActivityRowInputs {
	const ids = (src: RowKey["src"]) =>
		new Set(keys.filter((k) => k.src === src).map((k) => k.id));
	const category = (id: string | null) =>
		store.categories.find((c) => c.id === id) ?? null;

	const personalIds = ids("p");
	const personal = store.expenses
		.filter((e) => e.userId === store.userId && personalIds.has(e.id))
		.map(
			(e): PersonalRowInput => ({
				id: e.id,
				direction: e.direction,
				entryKind: e.entryKind,
				inType: e.inType,
				title: e.title,
				amount: e.amount,
				currency: e.currency,
				amountInUSD: e.amountInUSD,
				homeCurrency: e.homeCurrency,
				homeAmount: e.homeAmount,
				homeRate: e.homeRate,
				rateType: e.rateType,
				date: e.date,
				excludeFromAnalytics: e.excludeFromAnalytics,
				isAmortizedParent: e.isAmortizedParent,
				category: category(e.categoryId),
				childCount: store.expenses.filter((c) => c.parentId === e.id).length,
			}),
		);

	const sharedIds = ids("s");
	const shares = store.splits
		.filter(
			(p) =>
				p.participantType === "user" &&
				p.participantId === store.userId &&
				sharedIds.has(p.transactionId),
		)
		.flatMap((p): SharedRowInput[] => {
			const t = store.transactions.find((x) => x.id === p.transactionId);
			if (!t) return [];
			const { categoryId, ...tx } = t;
			return [
				{
					shareAmount: p.shareAmount,
					verificationStatus: p.verificationStatus,
					transaction: {
						...tx,
						project: store.projects.find((x) => x.id === t.projectId) ?? null,
						category: category(categoryId),
						splitParticipants: store.splits
							.filter((s) => s.transactionId === t.id)
							.map((s) => ({
								participantType: s.participantType,
								participantId: s.participantId,
							})),
					},
				},
			];
		});

	const groups = new Set(
		keys.filter((k) => k.src === "g").map((k) => splitPaymentKey(k.id).group),
	);
	const me = (type: string, id: string) =>
		type === "user" && id === store.userId;
	const payments = store.settlements
		.filter(
			(r) =>
				!r.isOffset &&
				r.kind === "PAYMENT" &&
				r.status !== "REJECTED" &&
				((r.paymentGroupId !== null && groups.has(r.paymentGroupId)) ||
					(r.paymentGroupId === null && groups.has(r.id))) &&
				(me(r.fromParticipantType, r.fromParticipantId) ||
					me(r.toParticipantType, r.toParticipantId)),
		)
		.map(
			(r): PaymentRowInput => ({
				id: r.id,
				paymentGroupId: r.paymentGroupId,
				currency: r.currency,
				amount: r.amount,
				status: r.status,
				initiatedAt: r.initiatedAt,
				fromParticipantType: r.fromParticipantType,
				fromParticipantId: r.fromParticipantId,
				toParticipantType: r.toParticipantType,
				toParticipantId: r.toParticipantId,
				project: store.projects.find((x) => x.id === r.project?.id) ?? null,
			}),
		);

	const projectIds = new Set(
		shares.flatMap((s) =>
			s.transaction.projectId ? [s.transaction.projectId] : [],
		),
	);
	const roles = strongestRoles(
		store.memberships.filter(
			(m) =>
				projectIds.has(m.projectId) &&
				me(m.participantType, m.participantId),
		),
	);

	const personKeys = new Set([
		...shares.flatMap((s) => [
			personKeyOf(s.transaction.paidByType, s.transaction.paidById),
			...s.transaction.splitParticipants.map((p) =>
				personKeyOf(p.participantType, p.participantId),
			),
		]),
		...payments.flatMap((r) => [
			personKeyOf(r.fromParticipantType, r.fromParticipantId),
			personKeyOf(r.toParticipantType, r.toParticipantId),
		]),
	]);
	const who: Record<string, Who> = {};
	for (const key of personKeys) {
		const w = store.people[key];
		if (w) who[key] = w;
	}

	return {
		personal,
		shares,
		payments,
		who,
		roles: Object.fromEntries(roles),
		rateRows: rateRowsByCurrency(
			store.rateRows,
			activityRateCurrencies({ shares, payments }),
		),
	};
}

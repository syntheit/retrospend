/**
 * Payment groups: every settlement row one settle-up call creates shares a
 * paymentGroupId. A payment entered in the People view becomes one row per
 * project scope, and a full settle-up may add offset rows (isOffset) that
 * cancel opposite debts between scopes. The group is what the user sees and
 * acts on: confirm, reject, delete, void and remind apply to all its rows,
 * and history shows one entry per group. Legacy rows without a group id are a
 * group of one.
 *
 * Confirmation flags stay true to each row's own direction. The person who
 * recorded the group has agreed to every row, the other person has not (yet):
 * - a row from the recorder: confirmedByPayer = true, confirmedByPayee = false;
 * - an offset row towards the recorder: the flags are swapped.
 * So in a PROPOSED group the person still to confirm is the one whose own
 * flag is false on the rows, whichever way each row points.
 */

import { currencyDecimals } from "~/lib/money";

export interface GroupRow {
	id: string;
	fromParticipantType: string;
	fromParticipantId: string;
	toParticipantType: string;
	toParticipantId: string;
	amount: number | { toString(): string };
	currency: string;
	convertedAmount?: number | { toString(): string } | null;
	convertedCurrency?: string | null;
	status: string;
	confirmedByPayer: boolean;
	confirmedByPayee: boolean;
	autoConfirmedReason?: string | null;
	projectId: string | null;
	paymentGroupId?: string | null;
	isOffset?: boolean;
}

function num(v: number | { toString(): string }): number {
	return typeof v === "number" ? v : Number(v.toString());
}

/** Key that identifies the group a row belongs to. */
export function groupKeyOf(row: {
	id: string;
	paymentGroupId?: string | null;
}): string {
	return row.paymentGroupId ?? `row:${row.id}`;
}

/** Splits rows into groups, keeping the order of each group's first row. */
export function groupRows<T extends { id: string; paymentGroupId?: string | null }>(
	rows: T[],
): T[][] {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const key = groupKeyOf(row);
		let group = groups.get(key);
		if (!group) {
			group = [];
			groups.set(key, group);
		}
		group.push(row);
	}
	return [...groups.values()];
}

function sideOf(row: GroupRow, userId: string): "from" | "to" | null {
	if (row.fromParticipantType === "user" && row.fromParticipantId === userId)
		return "from";
	if (row.toParticipantType === "user" && row.toParticipantId === userId)
		return "to";
	return null;
}

/**
 * Status of the whole group. Rows of a group always share their status; a
 * mix can only come from legacy data, and then a rejected row wins (the
 * payee refused the payment) over a pending one.
 */
export function groupStatus(rows: GroupRow[]): string {
	if (rows.some((r) => r.status === "REJECTED")) return "REJECTED";
	if (rows.some((r) => r.status === "PROPOSED")) return "PROPOSED";
	return rows[0]?.status ?? "PROPOSED";
}

/** The other person on the group, seen from `userId`. */
export function groupCounterparty(
	rows: GroupRow[],
	userId: string,
): { participantType: string; participantId: string } | null {
	const row = rows[0];
	if (!row) return null;
	const side = sideOf(row, userId);
	if (side === "from")
		return {
			participantType: row.toParticipantType,
			participantId: row.toParticipantId,
		};
	if (side === "to")
		return {
			participantType: row.fromParticipantType,
			participantId: row.fromParticipantId,
		};
	return null;
}

export interface GroupRoles {
	/** `userId` is one of the two people on every row. */
	isParty: boolean;
	status: string;
	/** PROPOSED and waiting for `userId` to confirm or reject. */
	awaitingMe: boolean;
	/**
	 * `userId` recorded the group and the other person has not agreed to it:
	 * pending (or rejected) payments they sent, or payments they recorded as
	 * received.
	 */
	recordedByMe: boolean;
	/** `userId` may void the group (see SettlementService.voidAutoFinalizedSettlement). */
	canVoid: boolean;
}

export function groupRoles(rows: GroupRow[], userId: string): GroupRoles {
	const sides = rows.map((r) => sideOf(r, userId));
	const isParty = rows.length > 0 && sides.every((s) => s !== null);
	const status = groupStatus(rows);
	if (!isParty) {
		return {
			isParty,
			status,
			awaitingMe: false,
			recordedByMe: false,
			canVoid: false,
		};
	}

	const mine = rows.map((r, i) =>
		sides[i] === "from" ? r.confirmedByPayer : r.confirmedByPayee,
	);
	const theirs = rows.map((r, i) =>
		sides[i] === "from" ? r.confirmedByPayee : r.confirmedByPayer,
	);
	const awaitingMe = status === "PROPOSED" && mine.some((f) => !f);
	const recordedByMe = mine.every(Boolean) && theirs.some((f) => !f);

	// Voidable: final without a real agreement from the other side. Either
	// the other person is a ghost/guest (auto-confirmed, the current user is
	// the only one who can record), or the current user recorded a payment
	// they received and the payer never confirmed it.
	const otherIsUser =
		groupCounterparty(rows, userId)?.participantType === "user";
	const autoFinalized =
		status === "FINALIZED" &&
		rows.every((r) => r.autoConfirmedReason != null);
	const canVoid = autoFinalized && (otherIsUser ? recordedByMe : true);

	return { isParty, status, awaitingMe, recordedByMe, canVoid };
}

export interface GroupPart {
	projectId: string | null;
	currency: string;
	amount: number;
	isOffset: boolean;
	/** From `userId`'s side: "outgoing" = they pay on this row. */
	direction: "outgoing" | "incoming";
}

export interface GroupSummary {
	/** "square_up": offsets only, no cash moved. */
	kind: "payment" | "square_up";
	/** Direction of the cash from `userId`'s side (square-up: of the recorder's rows). */
	direction: "outgoing" | "incoming";
	/** Cash per currency (square-up: empty). */
	cashByCurrency: Array<{ currency: string; amount: number }>;
	/** Amount cancelled by offsets per currency (one side of the offsets). */
	offsetByCurrency: Array<{ currency: string; amount: number }>;
	/**
	 * One headline amount: the cash total in its only currency, or for a
	 * multi-currency payment the total in the payment currency the rows were
	 * converted to. Square-up: the offset total.
	 */
	amount: number;
	currency: string;
	parts: GroupPart[];
}

function addTo(list: Array<{ currency: string; amount: number }>, currency: string, amount: number) {
	const entry = list.find((e) => e.currency === currency);
	if (entry) entry.amount += amount;
	else list.push({ currency, amount });
}

export function summarizeGroup(rows: GroupRow[], userId: string): GroupSummary {
	const parts: GroupPart[] = rows.map((r) => ({
		projectId: r.projectId,
		currency: r.currency,
		amount: num(r.amount),
		isOffset: r.isOffset ?? false,
		direction: sideOf(r, userId) === "from" ? "outgoing" : "incoming",
	}));

	const cashParts = parts.filter((p) => !p.isOffset);
	const offsetParts = parts.filter((p) => p.isOffset);
	const kind = cashParts.length > 0 ? "payment" : "square_up";

	const cashByCurrency: Array<{ currency: string; amount: number }> = [];
	for (const p of cashParts) addTo(cashByCurrency, p.currency, p.amount);

	// Offsets come in matched pairs (one per direction), so either direction's
	// sum is the amount cancelled. Take the side opposite to the cash, which
	// for a payment is the payee's debts; for a square-up the incoming side.
	const leadDirection = cashParts[0]?.direction ?? "outgoing";
	const offsetByCurrency: Array<{ currency: string; amount: number }> = [];
	for (const p of offsetParts) {
		if (p.direction !== leadDirection) addTo(offsetByCurrency, p.currency, p.amount);
	}

	let amount: number;
	let currency: string;
	if (kind === "square_up") {
		amount = offsetByCurrency[0]?.amount ?? 0;
		currency = offsetByCurrency[0]?.currency ?? rows[0]?.currency ?? "USD";
	} else if (cashByCurrency.length === 1) {
		amount = cashByCurrency[0]!.amount;
		currency = cashByCurrency[0]!.currency;
	} else {
		// Multi-currency settle-all: rows are either already in the payment
		// currency or carry their amount converted to it.
		const converted = rows.find(
			(r) => !r.isOffset && r.convertedCurrency,
		)?.convertedCurrency;
		currency = converted ?? cashByCurrency[0]!.currency;
		amount = 0;
		for (const r of rows) {
			if (r.isOffset) continue;
			if (r.currency === currency) amount += num(r.amount);
			else if (r.convertedAmount != null && r.convertedCurrency === currency)
				amount += num(r.convertedAmount);
		}
	}

	return {
		kind,
		direction: leadDirection,
		cashByCurrency,
		offsetByCurrency,
		amount,
		currency,
		parts,
	};
}

/** Short English description of a group for notifications. */
export function describeGroupAmount(rows: GroupRow[], userId: string): string {
	const summary = summarizeGroup(rows, userId);
	const formatted = `${summary.currency} ${summary.amount.toFixed(currencyDecimals(summary.currency))}`;
	if (summary.kind === "square_up") return `an offset of ${formatted}`;
	return summary.cashByCurrency.length > 1
		? `${formatted} across ${summary.cashByCurrency.length} currencies`
		: formatted;
}

/**
 * What a confirm overwrote on a claim, kept in the confirm's audit entry so
 * payment.unconfirm can put the claim back exactly as the payer recorded
 * it: the header (amount, date, method, rate) and every settlement row
 * verbatim, never re-allocated. If the confirm had rewritten the rows and
 * anything between the two people changed since, the undo is refused rather
 * than guessed. Takes the open transaction (mutation files may not reach the
 * global db).
 */
import { TRPCError } from "@trpc/server";
import { openInstanceCells } from "~/server/crypto/field-open";
import { fieldsOfModel } from "~/server/crypto/fields";
import type { TextKeys } from "~/server/crypto/text-keys";
import { verbatim } from "~/server/db-tx";
import { computePairLedger } from "~/server/services/shared-expenses/balance";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import type { Payment, Prisma, Settlement } from "~prisma";
import { ledgerLines } from "./ledger";

type Tx = Prisma.TransactionClient;

/** A settlement row as JSON: Decimals as strings, dates as ISO strings. */
type RowSnapshot = Record<string, string | number | boolean | null>;

export interface ConfirmedOver {
	readonly amount: string;
	/** YYYY-MM-DD. */
	readonly paidOn: string;
	readonly paymentMethod: string | null;
	readonly rateType: string | null;
	readonly rate: string | null;
	readonly rateCurrency: string | null;
	/** Every row of the payment before the confirm. */
	readonly rows: readonly RowSnapshot[];
	/** The pair's ledger right after the confirm, from the confirmer's side. */
	readonly ledger: string;
}

const DATES = ["initiatedAt", "settledAt", "rejectedAt", "reminderSentAt"];

function snapshotRow(row: Settlement): RowSnapshot {
	const out: RowSnapshot = {};
	for (const [key, value] of Object.entries(row)) {
		if (value instanceof Date) out[key] = value.toISOString();
		else if (
			value === null ||
			["string", "number", "boolean"].includes(typeof value)
		)
			out[key] = value as string | number | boolean | null;
		else out[key] = String(value); // Decimal
	}
	return out;
}

function rowData(snapshot: RowSnapshot) {
	const data: Record<string, unknown> = { ...snapshot };
	for (const key of DATES)
		if (typeof data[key] === "string")
			data[key] = new Date(data[key] as string);
	return data as Prisma.SettlementCreateManyInput;
}

/** The pair's ledger lines as one comparable string. */
export async function ledgerFingerprint(
	tx: Tx,
	me: ParticipantRef,
	other: ParticipantRef,
): Promise<string> {
	return JSON.stringify(
		ledgerLines(await computePairLedger(tx, me, other, { viewer: me })),
	);
}

const SETTLEMENT_TEXT = Object.keys(fieldsOfModel("Settlement")?.columns ?? {});

/** A payment's text cells exactly as stored, sealed or not. */
export interface StoredText {
	readonly paymentMethod: string | null;
	/** Settlement id to its text columns. */
	readonly rows: ReadonlyMap<string, Record<string, string | null>>;
}

/**
 * Read raw, so nothing opens them: the database guards compare the audit
 * entry's `previous` with the stored row (settled_entry_ok,
 * claim_header_back_ok), and the undo puts these values back as they were.
 */
export async function storedText(
	tx: Pick<Tx, "$queryRaw">,
	paymentId: string,
): Promise<StoredText> {
	const [header] = await tx.$queryRaw<{ paymentMethod: string | null }[]>`
		SELECT "paymentMethod" FROM "payment" WHERE "id" = ${paymentId}`;
	const rows = await tx.$queryRaw<Record<string, string | null>[]>`
		SELECT * FROM "settlement" WHERE "paymentGroupId" = ${paymentId}`;
	return {
		paymentMethod: header?.paymentMethod ?? null,
		rows: new Map(
			rows.map((row) => [
				row.id as string,
				Object.fromEntries(SETTLEMENT_TEXT.map((c) => [c, row[c] ?? null])),
			]),
		),
	};
}

/** The claim before the confirm, plus the ledger after it, for the confirm's audit entry. */
export function previousOf(
	header: Payment,
	rows: readonly Settlement[],
	stored: StoredText,
	ledger: string,
): ConfirmedOver {
	return {
		amount: header.amount.toString(),
		paidOn: header.paidOn.toISOString().slice(0, 10),
		paymentMethod: stored.paymentMethod,
		rateType: header.rateType,
		rate: header.rate?.toString() ?? null,
		rateCurrency: header.rateCurrency,
		rows: rows.map((row) => {
			const text = stored.rows.get(row.id);
			if (!text) throw new Error("A settlement row changed while it was read");
			return { ...snapshotRow(row), ...text };
		}),
		ledger,
	};
}

/**
 * A confirm's `previous` as a client may see it: the stored text it keeps
 * opened with the instance key, under the AAD of the payment (the header's
 * method) and of each settlement row. Plaintext passes; a sealed cell opens
 * or fails the request, as on a model read. Other entries pass unchanged.
 *
 * Only `previous` is opened here. Every other text leaf of `changes` is
 * declared in JSON_CELLS (fields.ts) and sealed and opened by the extension
 * under the entry's own id, so nothing under `previous` is a declared leaf
 * and no string is handled twice.
 */
export async function openAuditChanges(
	keys: TextKeys,
	changes: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
	const previous = changes?.previous;
	const paymentId = changes?.paymentGroupId;
	if (!changes || !isOver(previous) || typeof paymentId !== "string")
		return changes;
	const header: Record<string, unknown> = {
		id: paymentId,
		paymentMethod: previous.paymentMethod,
	};
	const rows = previous.rows.map((row) => ({ ...row }));
	await openInstanceCells(keys, [
		{ row: header, table: "payment", column: "paymentMethod" },
		...rows.flatMap((row) =>
			SETTLEMENT_TEXT.map((column) => ({ row, table: "settlement", column })),
		),
	]);
	return {
		...changes,
		previous: { ...previous, paymentMethod: header.paymentMethod, rows },
	};
}

function isOver(v: unknown): v is ConfirmedOver {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.amount === "string" &&
		typeof o.paidOn === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(o.paidOn) &&
		Array.isArray(o.rows) &&
		o.rows.length > 0 &&
		typeof o.ledger === "string"
	);
}

/** The latest confirm of these rows and what it overwrote, or null. */
export async function readPrevious(
	tx: Tx,
	rowIds: readonly string[],
): Promise<ConfirmedOver | null> {
	const entry = await tx.auditLogEntry.findFirst({
		where: {
			targetType: "SETTLEMENT",
			targetId: { in: [...rowIds] },
			action: "SETTLED",
		},
		orderBy: { timestamp: "desc" },
		select: { changes: true },
	});
	const previous = (entry?.changes as Record<string, unknown> | null)?.previous;
	return isOver(previous) ? previous : null;
}

/**
 * Puts a confirmed claim back verbatim: its header and its rows as they
 * stood before the confirm. When the confirm rewrote the rows (a changed
 * amount), the pair's ledger must be as the confirm left it; otherwise the
 * old rows could pay debts that are no longer there, so the undo refuses.
 */
export async function restoreClaim(
	tx: Tx,
	header: Payment,
	rows: readonly Settlement[],
	previous: ConfirmedOver,
	sides: { me: ParticipantRef; other: ParticipantRef },
): Promise<Settlement[]> {
	const before = new Set(previous.rows.map((r) => r.id));
	const rewritten =
		rows.length !== before.size || rows.some((r) => !before.has(r.id));
	if (
		rewritten &&
		(await ledgerFingerprint(tx, sides.me, sides.other)) !== previous.ledger
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Something changed between you since this was confirmed, so it cannot be undone exactly.",
		});
	}
	await tx.settlement.deleteMany({ where: { paymentGroupId: header.id } });
	// The text goes back as the entry kept it, sealed or not: verbatim stores
	// a sealed cell only under the row and column it was sealed for.
	await verbatim(async () => {
		await tx.settlement.createMany({ data: previous.rows.map(rowData) });
		await tx.payment.update({
			where: { id: header.id },
			data: {
				status: "PROPOSED",
				amount: previous.amount,
				paidOn: new Date(`${previous.paidOn}T00:00:00.000Z`),
				paymentMethod: previous.paymentMethod,
				rateType: previous.rateType,
				rate: previous.rate,
				rateCurrency: previous.rateCurrency,
			},
		});
	});
	return tx.settlement.findMany({
		where: { paymentGroupId: header.id },
		orderBy: { initiatedAt: "asc" },
	});
}

/**
 * Write parity, compare only: when the server shows back a write the device
 * booked (an acked outbox entry), compare the device's rows with the pulled
 * ones. Nothing is written to the live store and nothing is shown; the result
 * is ids, field names and counts, never an amount, title or note.
 *
 * Nothing is booked again here: the entry carries the device's own rows, and
 * a row the ack's version does not name has been written since, so it is a
 * skip, never a difference (a false finding costs more than a missed one).
 * - no_rate: the server row carries no home booking to compare with.
 * - no_settings: the device holds no settings yet.
 * - settings_moved: the home currency differs from the one the device booked in.
 * - rates_moved: the rates changed after the write was booked (the server
 *   overwrites them daily), so the device may hold different ones from the
 *   server's at booking time.
 * A booking the device cannot compare is a finding (`refused`).
 *
 * Not compared: projectId (not a column of the engine's expense row).
 *
 * A recurring write changes a template too (the due date, the anchor, a
 * pause, an edit): `compareTemplate` holds the columns a write decides to the
 * pulled template. It reads no rates, so only the version and the columns can
 * make it skip or differ.
 */
import { dec } from "@retrospend/domain/precise-decimal";
import { ackedTableOf } from "@retrospend/domain/recurring-post/acked-table";
import type { PendingChange } from "./device/pending";
import { sameValue } from "./equal";
import type { BookedExpense } from "./expense-create-conformance";
import type { ExpenseRow, TextFreeExpenseRow } from "./expenses";
import { bookedOf } from "./local-expense-create";
import { type Reader, SETTINGS_ID } from "./port";
import { ratesAsOf } from "./rates";
import type { TemplateRow, TextFreeTemplateRow } from "./templates";
import { compareWealth } from "./write-parity-wealth";

export type SkipCode =
	| "no_rate"
	| "no_settings"
	| "settings_moved"
	| "rates_moved"
	/** The pulled row is not the one the ack named: another write came after. */
	| "changed_since"
	/** The write was undone before a pull could compare it. */
	| "undone"
	/** The acked entry aged out of the list before a pull could compare it. */
	| "expired"
	/** The row is gone from the pull, deleted elsewhere. */
	| "gone_already"
	/** A bulk action: the device and the server both left the row alone (a transfer's fee, a spread parent). */
	| "refused"
	/** A preview compare: the server has not seen the unsent entries the device preview started from. */
	| "pending_ahead";

export type WriteVerdict =
	| { id: string; outcome: "match" }
	| { id: string; outcome: "differs"; fields: readonly string[] }
	| { id: string; outcome: "skipped"; code: SkipCode }
	| { id: string; outcome: "rate_missing" }
	| { id: string; outcome: "refused" };

/**
 * The device and the server keep their own clocks, so a rate stamped this
 * close before the send may already be the one the server booked with.
 */
export const CLOCK_SKEW_MS = 5 * 60_000;

const COMPARED = [
	"status",
	"direction",
	"entryKind",
	"inType",
	"isAmortizedParent",
	"categoryKind",
	"categoryId",
	"date",
	"currency",
	"amount",
	"amountInUSD",
	"exchangeRate",
	"rateType",
	"homeCurrency",
	"homeRate",
	"homeAmount",
	"pricingSource",
] as const satisfies readonly (keyof BookedExpense)[];

const DECIMALS = new Set<string>([
	"amount",
	"amountInUSD",
	"exchangeRate",
	"homeRate",
	"homeAmount",
]);

/**
 * Whether two stored values of one expense column are the same. Decimals by
 * value: the server sends `Decimal.toFixed()` ("185400") and the device books
 * to its columns' scale ("185400.00"). Everything else exactly. The one owner
 * of that rule: the compare and the overlay's value check both read it.
 */
export function sameColumnValue(
	column: string,
	a: unknown,
	b: unknown,
): boolean {
	if (DECIMALS.has(column) && a != null && b != null)
		return dec(String(a)).eq(dec(String(b)));
	return sameValue(a, b);
}

/** The names of the booked fields that differ: decimals by value, the date by instant. */
export function differingFields(
	device: BookedExpense,
	server: BookedExpense,
): string[] {
	return COMPARED.filter((k) => !sameColumnValue(k, device[k], server[k]));
}

/**
 * Why a row booked at `bookedAt` into `home` cannot be held to the server's:
 * the device holds no settings, the home currency moved, or the rates changed
 * after the write was booked. The one owner, for every row that carries a
 * booked rate (an expense, a leg).
 */
export function bookingSkip(
	live: Reader,
	bookedAt: number,
	/** The home currency the row was booked into; undefined for a row with none (an account), which only the rates can move. */
	home: string | null | undefined,
): "no_settings" | "settings_moved" | "rates_moved" | null {
	const settings = live.get("settings", SETTINGS_ID);
	if (!settings) return "no_settings";
	if (home !== undefined && settings.homeCurrency !== home)
		return "settings_moved";
	const asOf = ratesAsOf(live);
	if (asOf !== null && !(Date.parse(asOf) <= bookedAt - CLOCK_SKEW_MS))
		return "rates_moved";
	return null;
}

const skipped = (id: string, code: SkipCode): WriteVerdict => ({
	id,
	outcome: "skipped",
	code,
});

/**
 * What a device-booked row and the row the server booked can differ in: the
 * booked fields, plus excludeFromAnalytics (the edit's patch rules decide it
 * on both sides) and recurringTemplateId (a posted row must name the template
 * it came from). `projectId` is not a column of the engine's expense row (a
 * personal expense has no project and the sync does not carry it), so there is
 * nothing on the device to compare it with.
 */
export function differingWriteFields(
	device: TextFreeExpenseRow,
	server: ExpenseRow,
): string[] {
	const fields = differingFields(
		bookedOf(device as ExpenseRow),
		bookedOf(server),
	);
	if (device.excludeFromAnalytics !== server.excludeFromAnalytics)
		fields.push("excludeFromAnalytics");
	if (
		(device.recurringTemplateId ?? null) !==
		(server.recurringTemplateId ?? null)
	)
		fields.push("recurringTemplateId");
	return fields;
}

/** The template columns a recurring write decides; text and the joined category are not on the device row. */
export const TEMPLATE_COMPARED = [
	"nextDueDate",
	"anchorDay",
	"isActive",
	"autoPay",
	"amount",
	"currency",
	"frequency",
	"categoryId",
	"amountMode",
] as const satisfies readonly (keyof TextFreeTemplateRow)[];

export type ComparedTemplate = Pick<
	TemplateRow,
	(typeof TEMPLATE_COMPARED)[number]
>;

/** The names of the template columns that differ: the amount by value, the due date by instant. */
export function differingTemplateFields(
	device: ComparedTemplate,
	server: ComparedTemplate,
): string[] {
	return TEMPLATE_COMPARED.filter(
		(k) => !sameColumnValue(k, device[k], server[k]),
	);
}

/** What the compare needs of an acked entry: when it was booked and the version the server answered with. */
export interface AckedWrite {
	/** Epoch ms the device booked the write, for `rates_moved`. */
	readonly bookedAt: number;
	/** The `updatedAt` of the row the server answered with; null for a delete, or when none was given. */
	readonly version: string | null;
	/**
	 * The `updatedAt` of an expense the entry booked next to the row `version`
	 * names (a recurring confirm books one, and its answer names the template's).
	 * Absent when the server did not send it: the expense is then compared with
	 * no version, so a later edit of it reads as a difference, never as a match.
	 */
	readonly expenseVersion?: string;
}

/**
 * Compares one row of an acked write with the row a pull that began after the
 * ack brought, through `live` (a committed snapshot). A delete expects the
 * tombstone. A row the ack's version does not name has been written since, so
 * it is a skip, never a difference: a false finding costs more than a missed
 * one. Nothing is re-booked, so the verdict is ids and field names only.
 */
export function compareWrite(
	live: Reader,
	change: {
		readonly id: string;
		readonly before: TextFreeExpenseRow | null;
		readonly after: TextFreeExpenseRow | null;
	},
	acked: AckedWrite,
): WriteVerdict {
	const { id, before, after } = change;
	const pulled = live.get("expenses", id);
	if (after === null) {
		if (!pulled) return { id, outcome: "match" };
		return pulled.version !== (before?.version ?? null)
			? skipped(id, "changed_since")
			: { id, outcome: "differs", fields: ["deleted"] };
	}
	if (!pulled) return skipped(id, "gone_already");
	if (acked.version !== null && pulled.version !== acked.version)
		return skipped(id, "changed_since");
	const moved = bookingSkip(live, acked.bookedAt, after.homeCurrency);
	if (moved) return skipped(id, moved);
	try {
		bookedOf(pulled);
	} catch {
		return skipped(id, "no_rate");
	}
	try {
		const fields = differingWriteFields(after, pulled);
		return fields.length === 0
			? { id, outcome: "match" }
			: { id, outcome: "differs", fields };
	} catch {
		// The device row carries no booking: a finding, not a match.
		return { id, outcome: "refused" };
	}
}

/**
 * `compareWrite` for a template: the same deleted, gone and version rules, then
 * the template's own columns.
 */
export function compareTemplate(
	live: Reader,
	change: Extract<PendingChange, { table: "recurringTemplates" }>,
	acked: AckedWrite,
): WriteVerdict {
	const { id, before, after } = change;
	const pulled = live.get("recurringTemplates", id);
	if (after === null) {
		if (!pulled) return { id, outcome: "match" };
		return pulled.version !== (before?.version ?? null)
			? skipped(id, "changed_since")
			: { id, outcome: "differs", fields: ["deleted"] };
	}
	if (!pulled) return skipped(id, "gone_already");
	if (acked.version !== null && pulled.version !== acked.version)
		return skipped(id, "changed_since");
	const fields = differingTemplateFields(after, pulled);
	return fields.length === 0
		? { id, outcome: "match" }
		: { id, outcome: "differs", fields };
}

/**
 * `compareWrite`, `compareTemplate` or `compareWealth` for any row an entry
 * changed; null for a row that is not compared. A category row is not compared
 * yet: no category entry reaches the outbox until M3 PR3 (which adds its
 * compare beside this one).
 */
export function compareChange(
	live: Reader,
	change: PendingChange,
	acked: AckedWrite,
): WriteVerdict | null {
	if (change.table === "expenses") return compareWrite(live, change, acked);
	if (change.table === "recurringTemplates")
		return compareTemplate(live, change, acked);
	if (change.table === "categories") return null;
	return compareWealth(live, change, acked);
}

/**
 * Every row of one acked entry. The server's answer names one row's version
 * (`ackedTableOf`: a confirm or skip answers with the template's, though a
 * confirm also books an expense), so that version is held against that row
 * only. The booked expense carries its own (`expenseVersion`, contract 1.12.0);
 * with none, from an older server, it is held to its columns alone.
 */
export function compareEntry(
	live: Reader,
	changes: readonly PendingChange[],
	acked: AckedWrite,
): WriteVerdict[] {
	const named = ackedTableOf(changes);
	return changes.flatMap((c) => {
		const verdict = compareChange(live, c, {
			bookedAt: acked.bookedAt,
			version:
				c.table === named
					? acked.version
					: c.table === "expenses"
						? (acked.expenseVersion ?? null)
						: null,
		});
		return verdict ? [verdict] : [];
	});
}

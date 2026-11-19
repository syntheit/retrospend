/**
 * Write parity, compare only: after the server has booked a create the device
 * knows, book the same input here in a scratch store and compare the two rows.
 * Nothing is written to the live store and nothing is shown; the result is
 * ids, field names and counts, never an amount, title or note.
 *
 * The scratch store holds a copy of the live settings and rates, so the live
 * store takes no transaction (a pull never waits on it, a reset never races
 * it). The booking is createExpense through LocalDb.preview, and both rows go
 * through bookedOf and are compared as exact decimals.
 *
 * Only what createExpense books exactly is compared. The rest is a skip with
 * a code, never a guess:
 * - spread, split, transfer: not booked on the device.
 * - unknown_category: the category row has not arrived.
 * - no_rate: the server row carries no home booking to compare with.
 * - no_settings: the device holds no settings yet.
 * - rates_moved: the rates changed after the create was sent (the server
 *   overwrites them daily), so the device may hold different ones from the
 *   server's at booking time.
 * - settings_moved: the zone, the home currency or the preferred rate types
 *   differ from what they were when the create was sent.
 * A rate the server used and the device lacks is not a skip but a finding
 * (`rate_missing`), as is a booking the device refuses (`refused`).
 *
 * Known limit: the compare reads no version, so an edit made on the web or
 * another device between the create and the pull that is compared shows as
 * `differs`. The phone's own edits and deletes drop the capture first.
 *
 * Not compared: excludeFromAnalytics. The category's own excludeByDefault comes
 * from the store, but the field stays out of COMPARED.
 */
import { toBookingInput } from "@retrospend/domain/expense-input";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import { sameValue } from "./equal";
import { createExpense } from "./expense-create";
import type { BookedExpense } from "./expense-create-conformance";
import type { ExpenseRow, TextFreeExpenseRow } from "./expenses";
import { LocalDb } from "./local-db";
import { bookedOf } from "./local-expense-create";
import { MemoryStore } from "./memory-store";
import { type Reader, SETTINGS_ID, type SettingsRow } from "./port";
import { ratesAsOf } from "./rates";

export type CaptureKind = "expense" | "split" | "transfer";

/** The fields of a create body that decide how it books; no title, location or note. */
export interface CaptureBody {
	/** Decimal text. */
	amount: string;
	currency: string;
	/** YYYY-MM-DD in `zone`. */
	date: string;
	categoryId?: string;
	rateType?: string;
	/** A typed rate as decimal text. */
	customRate?: string;
	/** The body's own value; never read back from a category. */
	excludeFromAnalytics?: boolean;
	amortizeOver?: number;
}

/** A create the server accepted: what the device needs to book it again. */
export type CreateCapture = {
	id: string;
	/** The zone the server read the day in: settings.timeZone when it was sent. */
	zone: string;
	/** The home currency when it was sent. */
	homeCurrency: string;
	/** The preferred rate types when it was sent (see rateDefaultsKey). */
	rateDefaults: string;
	/** Epoch ms when the send began, which is no later than the server's createdAt. */
	at: number;
} & (
	| { kind: "expense"; body: CaptureBody }
	/** A split or a transfer is skipped, so its body is never kept. */
	| { kind: "split" | "transfer"; body?: undefined }
);

export type SkipCode =
	| "spread"
	| "split"
	| "transfer"
	| "unknown_category"
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
	/** A preview compare: the server has not seen the unsent entries the device preview started from. */
	| "pending_ahead";

export type WriteVerdict =
	| { id: string; outcome: "match" }
	| { id: string; outcome: "differs"; fields: readonly string[] }
	| { id: string; outcome: "skipped"; code: SkipCode }
	| { id: string; outcome: "rate_missing" }
	| { id: string; outcome: "refused" };

/** The settings' preferred rate types as one comparable text, key order aside. */
export const rateDefaultsKey = (settings: SettingsRow): string =>
	JSON.stringify(Object.entries(settings.defaultRateTypes ?? {}).sort());

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

const skipped = (id: string, code: SkipCode): WriteVerdict => ({
	id,
	outcome: "skipped",
	code,
});

/** A scratch store with a copy of `live`'s settings and rates. */
async function scratchOf(live: Reader, settings: SettingsRow) {
	const store = new MemoryStore();
	await store.transaction((tx) => {
		tx.put("settings", settings);
		for (const r of live.list("rates")) tx.put("rates", r);
	});
	return store;
}

/**
 * Books `capture` on the device and compares it with the synced row. `live`
 * is a committed snapshot of the device store; the synced row is read from it.
 */
export async function compareCreate(
	live: Reader,
	capture: CreateCapture,
): Promise<WriteVerdict> {
	const { id } = capture;
	if (capture.kind !== "expense") return skipped(id, capture.kind);
	const { body } = capture;
	if ((body.amortizeOver ?? 0) > 1) return skipped(id, "spread");
	const settings = live.get("settings", SETTINGS_ID);
	if (!settings) return skipped(id, "no_settings");
	if (
		settings.timeZone !== capture.zone ||
		settings.homeCurrency !== capture.homeCurrency ||
		rateDefaultsKey(settings) !== capture.rateDefaults
	)
		return skipped(id, "settings_moved");
	const asOf = ratesAsOf(live);
	if (asOf !== null && !(Date.parse(asOf) <= capture.at - CLOCK_SKEW_MS))
		return skipped(id, "rates_moved");
	const category = body.categoryId
		? live.get("categories", body.categoryId)
		: undefined;
	if (body.categoryId && !category) return skipped(id, "unknown_category");
	const synced = live.get("expenses", id);
	if (!synced) throw new Error(`expense ${id} is not synced`);
	let server: BookedExpense;
	try {
		server = bookedOf(synced);
	} catch {
		return skipped(id, "no_rate");
	}
	try {
		const { value } = await new LocalDb(
			await scratchOf(live, settings),
		).preview(
			createExpense({
				...toBookingInput({ ...body, id, title: "-" }, capture.zone),
				...(category
					? {
							category: {
								id: category.id,
								kind: category.kind,
								excludeByDefault: category.excludeByDefault,
							},
						}
					: {}),
			}),
		);
		const fields = differingFields(bookedOf(value), server);
		return fields.length === 0
			? { id, outcome: "match" }
			: { id, outcome: "differs", fields };
	} catch (error) {
		return error instanceof MissingRateError
			? { id, outcome: "rate_missing" }
			: { id, outcome: "refused" };
	}
}

/**
 * What a device-booked row and the row the server booked can differ in: the
 * booked fields, plus excludeFromAnalytics (the edit's patch rules decide it
 * on both sides). `projectId` is not a column of the engine's expense row (a
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
	return fields;
}

/** What the compare needs of an acked entry: when it was booked and the version the server answered with. */
export interface AckedWrite {
	/** Epoch ms the device booked the write, for `rates_moved`. */
	readonly bookedAt: number;
	/** The `updatedAt` of the row the server answered with; null for a delete, or when none was given. */
	readonly version: string | null;
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
	const settings = live.get("settings", SETTINGS_ID);
	if (!settings) return skipped(id, "no_settings");
	if (settings.homeCurrency !== after.homeCurrency)
		return skipped(id, "settings_moved");
	const asOf = ratesAsOf(live);
	if (asOf !== null && !(Date.parse(asOf) <= acked.bookedAt - CLOCK_SKEW_MS))
		return skipped(id, "rates_moved");
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

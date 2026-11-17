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
 * - rates_moved: the rates changed (the server overwrites them daily) or the
 *   preferred rate types did, after the create was sent, so the device may
 *   hold different ones from the server's at booking time.
 * A rate the server used and the device lacks is not a skip but a finding
 * (`rate_missing`), as is a booking the device refuses (`refused`).
 *
 * Not compared: excludeFromAnalytics. The store's category row has no
 * excludeByDefault, so the body's own value is passed and the field is left out.
 */
import { toBookingInput } from "@retrospend/domain/expense-input";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import { createExpense } from "./expense-create";
import type { BookedExpense } from "./expense-create-conformance";
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
export interface CreateCapture {
	id: string;
	kind: CaptureKind;
	/** Only for kind "expense". */
	body?: CaptureBody;
	/** The zone the server read the day in: settings.timeZone when it was sent. */
	zone: string;
	/** The preferred rate types when it was sent (see rateDefaultsKey). */
	rateDefaults: string;
	/** Epoch ms when the send began, which is no later than the server's createdAt. */
	at: number;
}

export type SkipCode =
	| "spread"
	| "split"
	| "transfer"
	| "unknown_category"
	| "no_rate"
	| "no_settings"
	| "rates_moved";

export type WriteVerdict =
	| { id: string; outcome: "match" }
	| { id: string; outcome: "differs"; fields: readonly string[] }
	| { id: string; outcome: "skipped"; code: SkipCode }
	| { id: string; outcome: "rate_missing" }
	| { id: string; outcome: "refused" };

/** The settings' preferred rate types as one comparable text, key order aside. */
export const rateDefaultsKey = (settings: SettingsRow): string =>
	JSON.stringify(Object.entries(settings.defaultRateTypes ?? {}).sort());

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

/** The names of the booked fields that differ: decimals by value, the date by instant. */
export function differingFields(
	device: BookedExpense,
	server: BookedExpense,
): string[] {
	return COMPARED.filter((k) => {
		const a = device[k];
		const b = server[k];
		if (a instanceof Date || b instanceof Date)
			return (
				!(a instanceof Date && b instanceof Date) || a.getTime() !== b.getTime()
			);
		return DECIMALS.has(k) ? !dec(a as string).eq(dec(b as string)) : a !== b;
	});
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
	const { id, body } = capture;
	if (capture.kind !== "expense" || !body)
		return skipped(id, capture.kind === "split" ? "split" : "transfer");
	if ((body.amortizeOver ?? 0) > 1) return skipped(id, "spread");
	const settings = live.get("settings", SETTINGS_ID);
	if (!settings) return skipped(id, "no_settings");
	const asOf = ratesAsOf(live);
	if (
		(asOf !== null && !(Date.parse(asOf) <= capture.at)) ||
		rateDefaultsKey(settings) !== capture.rateDefaults
	)
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
								excludeByDefault: false,
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

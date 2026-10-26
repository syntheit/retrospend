/**
 * The band a rate typed on a payment must stay in. A typed rate replaces the
 * stored one, so a slip ("0.000001" for "0.001") would clear a whole debt for
 * nothing. It must be within 0.2x to 5x of the stored rate of the currency
 * pair on the payment's date, and the database holds the same line
 * (rate_cross_band and payment_rates_check, migration settlement_followups),
 * so the app refuses with a clear error before the database would.
 *
 * The stored rate is read the way pickBestRate does: for each rate type, the
 * latest rate on or before the date, else the earliest after it. The band
 * runs from the lowest to the highest of what the types give, so a payment in
 * the "blue" rate is not refused for sitting above the "official" one.
 *
 * With no stored rate for the pair there is nothing to compare to, and a
 * missing rate is never 1. A typed rate is then taken only when it is the one
 * rate the payment converts at, because that is the one the database accepts
 * for an offset: the payment carries it as its own rate. Cash rows are not
 * held to the band in the database (a small pair, KRW into ETH, rounds its
 * rate to 0), so without offsets it is allowed.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { isCrypto } from "@retrospend/domain/currency-format";
import { USD } from "@retrospend/domain/money";
import { TRPCError } from "@trpc/server";
import { dec } from "~/server/services/envelope/units";
import type { Prisma } from "~prisma";
import type { PlannedSettlement } from "./allocate";

type RateDb = Pick<Prisma.TransactionClient, "exchangeRate">;

/** A rate may be this much below the lowest, and above the highest, stored rate. */
const BAND_LOW = "0.2";
const BAND_HIGH = "5";

/**
 * A typed rate the payment cannot take. A BAD_REQUEST on the web; API v1
 * answers it with its own problem code (`rate_out_of_range`), so a client can
 * tell it from any other bad request.
 */
export class RateOutOfRangeError extends TRPCError {
	constructor(message: string) {
		super({ code: "BAD_REQUEST", message });
		this.name = "RateOutOfRangeError";
	}
}

interface Range {
	readonly lo: Decimal;
	readonly hi: Decimal;
}

/** What one unit of the currency is worth in USD, lowest and highest over its rate types. */
async function usdRange(
	db: RateDb,
	currency: string,
	date: Date,
): Promise<Range | null> {
	if (currency === USD) return { lo: dec(1), hi: dec(1) };
	const where = { currency, rate: { gt: 0 } };
	const before = await db.exchangeRate.findMany({
		where: { ...where, date: { lte: date } },
		orderBy: [{ type: "asc" }, { date: "desc" }],
		distinct: ["type"],
		select: { type: true, rate: true },
	});
	const after = await db.exchangeRate.findMany({
		where: {
			...where,
			date: { gt: date },
			type: { notIn: before.map((r) => r.type) },
		},
		orderBy: [{ type: "asc" }, { date: "asc" }],
		distinct: ["type"],
		select: { type: true, rate: true },
	});
	const values = [...before, ...after].map((r) =>
		isCrypto(currency) ? dec(r.rate) : dec(1).div(dec(r.rate)),
	);
	if (values.length === 0) return null;
	return {
		lo: values.reduce((a, b) => (b.lt(a) ? b : a)),
		hi: values.reduce((a, b) => (b.gt(a) ? b : a)),
	};
}

/** Units of `into` per 1 unit of `from`, lowest and highest, or null without a stored rate. */
async function crossRange(
	db: RateDb,
	from: string,
	into: string,
	date: Date,
): Promise<Range | null> {
	const [f, t] = await Promise.all([
		usdRange(db, from, date),
		usdRange(db, into, date),
	]);
	if (!f || !t) return null;
	return { lo: f.lo.div(t.hi), hi: f.hi.div(t.lo) };
}

const outside = (rate: Decimal, band: Range) =>
	rate.lt(band.lo.mul(BAND_LOW)) || rate.gt(band.hi.mul(BAND_HIGH));

export interface TypedRateCheck {
	/** The payment currency. */
	readonly into: string;
	/** `rate` units of `into` per 1 unit of `currency`, as typed. */
	readonly custom: { readonly rate: string; readonly currency: string };
	readonly date: Date;
	/** The rows the payment writes. */
	readonly planned: readonly PlannedSettlement[];
}

/**
 * Refuses a typed rate that is out of the band, before anything is written.
 * Does nothing when the allocation did not use it.
 */
export async function assertTypedRate(
	db: RateDb,
	check: TypedRateCheck,
): Promise<void> {
	const { custom, planned } = check;
	const used = planned.filter(
		(r) => r.currency === custom.currency && r.quote?.rateType === "custom",
	);
	if (used.length === 0) return;
	const band = await crossRange(db, custom.currency, check.into, check.date);
	if (band) {
		// The payment keeps the rate as typed; an offset row keeps six decimals.
		const typed = dec(custom.rate);
		const stored = typed.toDecimalPlaces(6);
		if (
			outside(typed, band) ||
			(used.some((r) => r.isOffset) && outside(stored, band))
		) {
			throw new RateOutOfRangeError(
				`That ${custom.currency} rate is too far from the stored rate. Check it and try again.`,
			);
		}
		return;
	}
	const converted = new Set(
		planned.filter((r) => r.quote).map((r) => r.currency),
	);
	if (used.some((r) => r.isOffset) && converted.size > 1) {
		throw new RateOutOfRangeError(
			`A typed ${custom.currency} rate works only when ${custom.currency} is the one currency converted.`,
		);
	}
}

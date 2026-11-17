/**
 * The one mapping from an expense-create body to the booking input, shared by
 * the web's tRPC create (entry/input.ts), the v1 POST /expenses route
 * (api-v1/expenses.ts) and the device engine. Pure and zod-free: the callers
 * validate, this only turns the day into an instant and picks the rate.
 *
 * - `date` is a YYYY-MM-DD day, read as the start of that day in `timeZone`,
 *   the zone the request used (the browser's or the phone's), so the same
 *   body books the same instant on every path.
 * - A typed `customRate` wins over a `rateType`; with neither, the booking
 *   falls to the home currency's default type. The typed rate is quoted for
 *   one unit of the expense's own currency (`base`).
 * - Every other field passes through as it is.
 */
import { parseDateOnlyIn } from "./time-zone";

/** The fields of a create body that decide how it books. */
export interface ExpenseBody {
	/** YYYY-MM-DD in the request's zone. */
	date: string;
	currency: string;
	/** A rate type of the pair (official, blue...); ignored when a rate is typed. */
	rateType?: string;
	/** A typed rate as decimal text: 1 unit of `currency` is this many units of home. */
	customRate?: string;
}

/** The rate a body asks for, in the booking input's own shape. */
export type BookingRate =
	| { customRate: { base: string; value: string }; rateType?: never }
	| { rateType: string; customRate?: never }
	| { rateType?: never; customRate?: never };

/** `body` as booking input: the day an instant, the rate chosen, the rest as given. */
export type BookingInput<T extends ExpenseBody> = Omit<
	T,
	"date" | "customRate" | "rateType"
> & { date: Date } & BookingRate;

export function toBookingInput<T extends ExpenseBody>(
	body: T,
	timeZone?: string,
): BookingInput<T> {
	const { date, customRate, rateType, ...rest } = body;
	const rate: BookingRate = customRate
		? { customRate: { base: body.currency, value: customRate } }
		: rateType
			? { rateType }
			: {};
	return { ...rest, date: parseDateOnlyIn(date, timeZone), ...rate };
}

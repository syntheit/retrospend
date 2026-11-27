/**
 * What the transfer rules refuse, as typed errors. The domain knows no
 * transport: the server maps each to a bad request with the same message
 * (asBadRequest in src/server/services/rate-types.ts) and the device to its
 * own input error.
 */
import { MissingRateError } from "../money-dec";

/** The person's input cannot make this move (kind, amount, places, currency). */
export class TransferRefusal extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TransferRefusal";
	}
}

/**
 * No rate values the arrival of an exchange with no typed amount. A
 * MissingRateError (never a rate of 1), worded for the person who must type
 * what arrived.
 */
export class NoArrivalRateError extends MissingRateError {
	constructor(from: string, to: string) {
		super(to, [from, to]);
		this.message = `No exchange rate for ${from} to ${to}. Type what arrived.`;
	}
}

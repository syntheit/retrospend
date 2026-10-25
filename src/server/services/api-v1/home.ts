import { isFlagEnabled } from "~/server/flags";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { glance } from "~/server/services/figures/glance";
import { needsYou } from "~/server/services/needs-you";
import type { Caller } from "./caller";

/** v1 adapters for Home's two reads, the same calls as routers/home.ts. */

type LedgerCaller = Caller & { timeZone: string };

/** The service types are readonly; the wire types are plain. This only drops `readonly`. */
type Writable<T> = T extends readonly (infer U)[]
	? Writable<U>[]
	: T extends object
		? { -readonly [K in keyof T]: Writable<T[K]> }
		: T;

const writable = <T>(value: T) => value as Writable<T>;

const budgetOn = (caller: Caller) =>
	isFlagEnabled("envelopeBudget", { role: caller.principal.role });

export async function readNeedsYou(caller: LedgerCaller) {
	return writable(
		await needsYou(caller.db, caller.principal.userId, {
			budget: await budgetOn(caller),
			timeZone: caller.timeZone,
			emailEnabled: await isEmailDeliveryEnabled(),
		}),
	);
}

export async function readGlance(caller: LedgerCaller) {
	return writable(
		await glance(caller.db, caller.principal.userId, {
			budget: await budgetOn(caller),
			timeZone: caller.timeZone,
		}),
	);
}

import type {
	rateOptionsQuerySchema,
	setDefaultRateTypeSchema,
} from "@retrospend/api-contract";
import type * as z from "zod";
import { entryCatalog } from "~/server/services/entry/catalog";
import { rateOptionsView } from "~/server/services/entry/views";
import {
	getDefaultRateTypes,
	rateOptions,
	setDefaultRateType,
} from "~/server/services/rate-types";
import type { Caller } from "./caller";
import { thaw } from "./thaw";

/** v1 adapters for /entry: the reads the Add sheets make, as the web makes them. */

type RateQuery = z.infer<typeof rateOptionsQuerySchema>;
type DefaultBody = z.infer<typeof setDefaultRateTypeSchema>;

export async function readEntryCatalog(caller: Caller) {
	return thaw(await entryCatalog(caller.db, caller.principal.userId));
}

export async function readRateOptions(caller: Caller, q: RateQuery) {
	const options = await rateOptions(caller.db, caller.principal.userId, {
		currency: q.currency,
		date: new Date(`${q.date}T12:00:00.000Z`),
		amount: q.amount,
		customRate: q.customRate,
	});
	return thaw(rateOptionsView(q.currency, options));
}

const listOf = (defaults: Record<string, string>) => ({
	items: Object.entries(defaults)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([homeCurrency, rateType]) => ({ homeCurrency, rateType })),
});

export async function listDefaultRateTypes(caller: Caller) {
	return listOf(await getDefaultRateTypes(caller.db, caller.principal.userId));
}

export async function putDefaultRateType(caller: Caller, body: DefaultBody) {
	return listOf(
		await setDefaultRateType(
			caller.db,
			caller.principal.userId,
			body.homeCurrency,
			body.rateType,
		),
	);
}

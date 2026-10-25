import * as entry from "~/server/services/api-v1/entry";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const e = v1.entry;

export const entryRouter = {
	catalog: e.catalog.handler(
		serve(({ context }) => entry.readEntryCatalog(signedIn(context))),
	),
	rateOptions: e.rateOptions.handler(
		serve(({ context, input }) =>
			entry.readRateOptions(signedIn(context), input),
		),
	),
	defaultRateTypes: e.defaultRateTypes.handler(
		serve(({ context }) => entry.listDefaultRateTypes(signedIn(context))),
	),
	setDefaultRateType: e.setDefaultRateType.handler(
		serve(({ context, input }) =>
			entry.putDefaultRateType(signedIn(context), input),
		),
	),
};

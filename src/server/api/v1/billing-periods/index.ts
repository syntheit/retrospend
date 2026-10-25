import * as periods from "~/server/services/api-v1/billing-periods";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const b = v1["billing-periods"];

export const billingPeriodsRouter = {
	list: b.list.handler(
		serve(({ context, input }) =>
			periods.listBillingPeriods(signedIn(context), input.id),
		),
	),
	get: b.get.handler(
		serve(({ context, input }) =>
			periods.readBillingPeriod(signedIn(context), input.id, input.periodId),
		),
	),
	closeCurrent: b.closeCurrent.handler(
		serve(({ context, input }) =>
			periods.closeBillingPeriod(signedIn(context), input.id),
		),
	),
	settle: b.settle.handler(
		serve(({ context, input }) =>
			periods.settleBillingPeriod(signedIn(context), input.id, input.periodId),
		),
	),
	rename: b.rename.handler(
		serve(({ context, input }) =>
			periods.renameBillingPeriod(signedIn(context), input),
		),
	),
};

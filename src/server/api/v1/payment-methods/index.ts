import * as methods from "~/server/services/api-v1/payment-methods";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const p = v1["payment-methods"];

export const paymentMethodsRouter = {
	list: p.list.handler(
		serve(({ context }) => methods.listPaymentMethods(signedIn(context))),
	),
	replace: p.replace.handler(
		serve(({ context, input }) =>
			methods.replacePaymentMethods(signedIn(context), input.methods),
		),
	),
	match: p.match.handler(
		serve(({ context, input }) =>
			methods.matchPaymentMethods(signedIn(context), input),
		),
	),
};

/**
 * Envelope procedures for debts (P6: SPEC §5.11), merged flat into the
 * envelope router (envelope.*). Thin: contracts from
 * ~/lib/schemas/envelope-debt, logic in the services. Terms and the payoff
 * plan move no money (their results carry `previous` for an undo); Pay down
 * a debt is a preview and apply pair of one mutation (R30).
 */
import { applyOutputSchema, previewOutputSchema } from "~/lib/schemas/envelope";
import {
	debtPaymentResultSchema,
	debtTermsResultSchema,
	interestEstimateInputSchema,
	interestEstimateSchema,
	payoffPlanResultSchema,
	payoffPlanSchema,
	payoffProjectInputSchema,
	payoffProjectionSchema,
	recordDebtPaymentInputSchema,
	savePayoffPlanInputSchema,
	setDebtTermsInputSchema,
} from "~/lib/schemas/envelope-debt";
import { recordDebtPaymentMutation } from "~/server/services/envelope/debt.mutation";
import { debtsApi } from "~/server/services/envelope/debt-api.service";
import { apply, envelopeProcedure, preview } from "./envelope-procedure";

const uid = (ctx: { session: { user: { id: string } } }) => ctx.session.user.id;

export const envelopeDebtProcedures = {
	/** APR, minimum and due day of a liability (the Wealth account sheet). */
	setDebtTerms: envelopeProcedure
		.input(setDebtTermsInputSchema)
		.output(debtTermsResultSchema)
		.mutation(({ ctx, input }) => debtsApi.setTerms(uid(ctx), input)),

	payoffPlan: envelopeProcedure
		.output(payoffPlanSchema)
		.query(({ ctx }) => debtsApi.plan(uid(ctx))),
	savePayoffPlan: envelopeProcedure
		.input(savePayoffPlanInputSchema)
		.output(payoffPlanResultSchema)
		.mutation(({ ctx, input }) => debtsApi.savePlan(uid(ctx), input)),
	/** Debt-free month, total interest, payoff month per debt; never writes. */
	payoffProject: envelopeProcedure
		.input(payoffProjectInputSchema)
		.output(payoffProjectionSchema)
		.query(({ ctx, input }) => debtsApi.project(uid(ctx), input)),
	interestEstimate: envelopeProcedure
		.input(interestEstimateInputSchema)
		.output(interestEstimateSchema)
		.query(({ ctx, input }) => debtsApi.interest(uid(ctx), input.liabilityId)),

	recordDebtPaymentPreview: envelopeProcedure
		.input(recordDebtPaymentInputSchema)
		.output(previewOutputSchema(debtPaymentResultSchema))
		.mutation(preview(recordDebtPaymentMutation)),
	recordDebtPayment: envelopeProcedure
		.input(recordDebtPaymentInputSchema)
		.output(applyOutputSchema(debtPaymentResultSchema))
		.mutation(apply(recordDebtPaymentMutation)),
};

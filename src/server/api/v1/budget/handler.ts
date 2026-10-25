import {
	assertBudgetOn,
	type BudgetCaller,
	withEnvelopeErrors,
} from "~/server/services/api-v1/budget/serve";
import { serve } from "../core/serve";
import { signedIn, type V1Context } from "../middleware";

/**
 * A budget handler: the signed-in caller, the envelopeBudget flag, engine
 * errors as problems (and TRPCError ones through `serve`).
 */
export function budgetHandler<I, R>(
	run: (caller: BudgetCaller, input: I) => Promise<R>,
) {
	return serve(async ({ context, input }: { context: V1Context; input: I }) => {
		const caller = signedIn(context);
		await assertBudgetOn(caller);
		return withEnvelopeErrors(() => run(caller, input));
	});
}

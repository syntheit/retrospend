import { problem } from "~/server/api/v1/errors";
import {
	type ExpectedAccountState,
	requireAccountState,
} from "~/server/services/accounts/expected-state";
import type { MoneyMutation } from "~/server/services/preview/types";

/**
 * An account write that names the version (and, for Update balance, the
 * balance) its caller read runs only while the account still has them;
 * otherwise it answers 409 account_changed with nothing written. The compare
 * is requireAccountState, in the mutation's own transaction, the same for the
 * preview twin. Without either field the mutation is untouched.
 */
export function guardedAccount<
	I extends { id: string } & ExpectedAccountState,
	V,
>(mutation: MoneyMutation<I, V>): MoneyMutation<I, V> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			await requireAccountState(tx, actor.userId, input.id, input, () =>
				problem("account_changed", "This account changed since you read it"),
			);
			return mutation.run(tx, input, actor);
		},
	};
}

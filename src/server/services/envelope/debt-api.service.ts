/**
 * Debts for transports (tRPC now, /api/v1 later): one RLS transaction per
 * call. Terms and the payoff plan move no money; Pay down a debt is a money
 * mutation (debt.mutation.ts).
 */
import type {
	DebtTermsResult,
	InterestEstimate,
	PayoffPlanDto,
	PayoffPlanResult,
	PayoffProjectInput,
	PayoffProjection,
	SavePayoffPlanInput,
	SetDebtTermsInput,
} from "~/lib/schemas/envelope-debt";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import {
	getPayoffPlan,
	projectIn,
	revertPayoffPlan,
	savePayoffPlan,
	setDebtTerms,
} from "./debt.service";
import { interestEstimate } from "./debt-payment.service";

export const debtsApi = {
	setTerms: (
		userId: string,
		input: SetDebtTermsInput,
	): Promise<DebtTermsResult> =>
		userTransaction(db, userId, (tx) => setDebtTerms(tx, input)),
	plan: (userId: string): Promise<PayoffPlanDto> =>
		userTransaction(db, userId, (tx) => getPayoffPlan(tx, userId)),
	savePlan: (
		userId: string,
		input: SavePayoffPlanInput,
	): Promise<PayoffPlanResult> =>
		userTransaction(db, userId, (tx) => savePayoffPlan(tx, userId, input)),
	revertPlan: (userId: string): Promise<PayoffPlanResult> =>
		userTransaction(db, userId, (tx) => revertPayoffPlan(tx, userId)),
	project: (
		userId: string,
		input: PayoffProjectInput,
		now = new Date(),
	): Promise<PayoffProjection> =>
		userTransaction(db, userId, (tx) => projectIn(tx, userId, input, now)),
	interest: (
		userId: string,
		liabilityId: string,
		now = new Date(),
	): Promise<InterestEstimate> =>
		userTransaction(db, userId, (tx) =>
			interestEstimate(tx, userId, liabilityId, now),
		),
};

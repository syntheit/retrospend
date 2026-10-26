import { TRPCError } from "@trpc/server";
import { adminRouter } from "~/server/api/routers/admin";
import { auditLogRouter } from "~/server/api/routers/audit-log";
import { authRouter } from "~/server/api/routers/auth";
import { billingPeriodRouter } from "~/server/api/routers/billingPeriod";
import { expenseRouter } from "~/server/api/routers/expense";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { inviteRouter } from "~/server/api/routers/invite";
import { paymentMethodRouter } from "~/server/api/routers/paymentMethod";
import { profileRouter } from "~/server/api/routers/profile";
import { projectRouter } from "~/server/api/routers/project";
import { settingsRouter } from "~/server/api/routers/settings";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { verificationRouter } from "~/server/api/routers/verification";
import { createCallerFactory } from "~/server/api/trpc";
import type { Session } from "~/server/better-auth/config";
import { db } from "~/server/db";

/**
 * Admin, feedback and invite code logic lives inside tRPC
 * procedures (rate limits, role checks, audit events), not in
 * services. v1 calls those same procedures in-process, so both transports
 * run one implementation. The procedures check the role and the active
 * flag again from the session below, which comes from the user row, never
 * from the token.
 */

/** Who a procedure runs for: a request, or a background job that outlives it. */
export type BridgeCaller = {
	principal: { userId: string };
	timeZone: string;
	/** The request's headers, for the few procedures that read the caller's address. */
	headers?: Headers;
};

/** The part of a web session the procedures above read. */
type BridgeUser = Pick<
	Session["user"],
	"id" | "name" | "email" | "username" | "role" | "isActive" | "timeZone"
>;

async function contextFor(caller: BridgeCaller) {
	const row = await db.user.findUnique({
		where: { id: caller.principal.userId },
		select: {
			id: true,
			name: true,
			email: true,
			username: true,
			role: true,
			isActive: true,
		},
	});
	// A user deleted while the request ran is a sign-in problem, not a crash.
	if (!row) throw new TRPCError({ code: "UNAUTHORIZED" });
	const user: BridgeUser = { ...row, timeZone: caller.timeZone };
	return {
		db,
		headers: caller.headers ?? new Headers(),
		// protectedProcedure reads only `user`; the session row is not needed.
		session: { user } as unknown as Session,
	};
}

const adminFactory = createCallerFactory(adminRouter);
const expenseFactory = createCallerFactory(expenseRouter);
const feedbackFactory = createCallerFactory(feedbackRouter);
const inviteFactory = createCallerFactory(inviteRouter);
const projectFactory = createCallerFactory(projectRouter);
const billingPeriodFactory = createCallerFactory(billingPeriodRouter);
const paymentMethodFactory = createCallerFactory(paymentMethodRouter);
const auditLogFactory = createCallerFactory(auditLogRouter);
const authFactory = createCallerFactory(authRouter);
const profileFactory = createCallerFactory(profileRouter);
const settingsFactory = createCallerFactory(settingsRouter);
const sharedTransactionFactory = createCallerFactory(sharedTransactionRouter);
const verificationFactory = createCallerFactory(verificationRouter);

export const trpcAdmin = async (c: BridgeCaller) =>
	adminFactory(await contextFor(c));
export const trpcExpense = async (c: BridgeCaller) =>
	expenseFactory(await contextFor(c));
export const trpcFeedback = async (c: BridgeCaller) =>
	feedbackFactory(await contextFor(c));
export const trpcInvite = async (c: BridgeCaller) =>
	inviteFactory(await contextFor(c));
export const trpcProject = async (c: BridgeCaller) =>
	projectFactory(await contextFor(c));
export const trpcBillingPeriod = async (c: BridgeCaller) =>
	billingPeriodFactory(await contextFor(c));
export const trpcPaymentMethod = async (c: BridgeCaller) =>
	paymentMethodFactory(await contextFor(c));
export const trpcAuditLog = async (c: BridgeCaller) =>
	auditLogFactory(await contextFor(c));
export const trpcAuth = async (c: BridgeCaller) =>
	authFactory(await contextFor(c));
export const trpcProfile = async (c: BridgeCaller) =>
	profileFactory(await contextFor(c));
export const trpcSettings = async (c: BridgeCaller) =>
	settingsFactory(await contextFor(c));
export const trpcSharedTransaction = async (c: BridgeCaller) =>
	sharedTransactionFactory(await contextFor(c));
export const trpcVerification = async (c: BridgeCaller) =>
	verificationFactory(await contextFor(c));

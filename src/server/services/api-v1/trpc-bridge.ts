import { isProtected } from "@retrospend/api-contract/protection-state";
import { TRPCError } from "@trpc/server";
import { ProtectedAccountError } from "~/server/api/protection/guard";
import { adminRouter } from "~/server/api/routers/admin";
import { auditLogRouter } from "~/server/api/routers/audit-log";
import { authRouter } from "~/server/api/routers/auth";
import { billingPeriodRouter } from "~/server/api/routers/billingPeriod";
import { expenseRouter } from "~/server/api/routers/expense";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { guestRouter } from "~/server/api/routers/guest";
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
	| "id"
	| "name"
	| "email"
	| "username"
	| "role"
	| "isActive"
	| "timeZone"
	| "protectionState"
>;

/**
 * Passed by a v1 service whose route already ran the protection guard
 * (middleware.ts authenticate: scope, V1_ALLOWED, protected principal), which
 * is what decided this call may happen. The tRPC allowlist cannot match a
 * bridged path ("recordConsent", not "auth.recordConsent"), so guarding again
 * would refuse every bridged route of a protected account that the v1 list
 * allows. Nothing else passes it: a caller without it is refused when the
 * account is protected (the export job reads the state itself and passes
 * none).
 */
export const V1_GUARDED = { guardedByV1: true } as const;
type BridgeGuard = typeof V1_GUARDED;

async function contextFor(caller: BridgeCaller, guard?: BridgeGuard) {
	const row = await db.user.findUnique({
		where: { id: caller.principal.userId },
		select: {
			id: true,
			name: true,
			email: true,
			username: true,
			role: true,
			isActive: true,
			protectionState: true,
		},
	});
	// A user deleted while the request ran is a sign-in problem, not a crash.
	if (!row) throw new TRPCError({ code: "UNAUTHORIZED" });
	if (!guard && isProtected(row.protectionState))
		throw new ProtectedAccountError();
	const user: BridgeUser = { ...row, timeZone: caller.timeZone };
	return {
		db,
		headers: caller.headers ?? new Headers(),
		// protectedProcedure reads only `user`; the session row is not needed.
		session: { user } as unknown as Session,
		...(guard ?? {}),
	};
}

const adminFactory = createCallerFactory(adminRouter);
const expenseFactory = createCallerFactory(expenseRouter);
const feedbackFactory = createCallerFactory(feedbackRouter);
const guestFactory = createCallerFactory(guestRouter);
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

export const trpcAdmin = async (c: BridgeCaller, guard?: BridgeGuard) =>
	adminFactory(await contextFor(c, guard));
export const trpcExpense = async (c: BridgeCaller, guard?: BridgeGuard) =>
	expenseFactory(await contextFor(c, guard));
export const trpcFeedback = async (c: BridgeCaller, guard?: BridgeGuard) =>
	feedbackFactory(await contextFor(c, guard));
export const trpcGuest = async (c: BridgeCaller, guard?: BridgeGuard) =>
	guestFactory(await contextFor(c, guard));
export const trpcInvite = async (c: BridgeCaller, guard?: BridgeGuard) =>
	inviteFactory(await contextFor(c, guard));
export const trpcProject = async (c: BridgeCaller, guard?: BridgeGuard) =>
	projectFactory(await contextFor(c, guard));
export const trpcBillingPeriod = async (c: BridgeCaller, guard?: BridgeGuard) =>
	billingPeriodFactory(await contextFor(c, guard));
export const trpcPaymentMethod = async (c: BridgeCaller, guard?: BridgeGuard) =>
	paymentMethodFactory(await contextFor(c, guard));
export const trpcAuditLog = async (c: BridgeCaller, guard?: BridgeGuard) =>
	auditLogFactory(await contextFor(c, guard));
export const trpcAuth = async (c: BridgeCaller, guard?: BridgeGuard) =>
	authFactory(await contextFor(c, guard));
export const trpcProfile = async (c: BridgeCaller, guard?: BridgeGuard) =>
	profileFactory(await contextFor(c, guard));
export const trpcSettings = async (c: BridgeCaller, guard?: BridgeGuard) =>
	settingsFactory(await contextFor(c, guard));
export const trpcSharedTransaction = async (
	c: BridgeCaller,
	guard?: BridgeGuard,
) => sharedTransactionFactory(await contextFor(c, guard));
export const trpcVerification = async (c: BridgeCaller, guard?: BridgeGuard) =>
	verificationFactory(await contextFor(c, guard));

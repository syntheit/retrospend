import { adminRouter } from "~/server/api/routers/admin";
import { auditLogRouter } from "~/server/api/routers/audit-log";
import { billingPeriodRouter } from "~/server/api/routers/billingPeriod";
import { expenseRouter } from "~/server/api/routers/expense";
import { exportRouter } from "~/server/api/routers/export";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { inviteRouter } from "~/server/api/routers/invite";
import { paymentMethodRouter } from "~/server/api/routers/paymentMethod";
import { projectRouter } from "~/server/api/routers/project";
import { TRPCError } from "@trpc/server";
import { createCallerFactory } from "~/server/api/trpc";
import type { Session } from "~/server/better-auth/config";
import { db } from "~/server/db";

/**
 * Admin, export, feedback and invite code logic lives inside tRPC
 * procedures (rate limits, role checks, audit events, documents), not in
 * services. v1 calls those same procedures in-process, so both transports
 * run one implementation. The procedures check the role and the active
 * flag again from the session below, which comes from the user row, never
 * from the token.
 */

/** Who a procedure runs for: a request, or a background job that outlives it. */
export type BridgeCaller = {
	principal: { userId: string };
	timeZone: string;
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
		headers: new Headers(),
		// protectedProcedure reads only `user`; the session row is not needed.
		session: { user } as unknown as Session,
	};
}

const adminFactory = createCallerFactory(adminRouter);
const exportFactory = createCallerFactory(exportRouter);
const expenseFactory = createCallerFactory(expenseRouter);
const feedbackFactory = createCallerFactory(feedbackRouter);
const inviteFactory = createCallerFactory(inviteRouter);
const projectFactory = createCallerFactory(projectRouter);
const billingPeriodFactory = createCallerFactory(billingPeriodRouter);
const paymentMethodFactory = createCallerFactory(paymentMethodRouter);
const auditLogFactory = createCallerFactory(auditLogRouter);

export const trpcAdmin = async (c: BridgeCaller) =>
	adminFactory(await contextFor(c));
export const trpcExport = async (c: BridgeCaller) =>
	exportFactory(await contextFor(c));
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

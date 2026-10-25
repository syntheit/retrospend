import { createCallerFactory } from "~/server/api/trpc";
import { adminRouter } from "~/server/api/routers/admin";
import { exportRouter } from "~/server/api/routers/export";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { inviteRouter } from "~/server/api/routers/invite";
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

async function contextFor(caller: BridgeCaller) {
	const user = await db.user.findUniqueOrThrow({
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
	return {
		db,
		headers: new Headers(),
		// The shape protectedProcedure reads; the rest of a web session is unused.
		session: {
			user: { ...user, timeZone: caller.timeZone },
		} as never,
	};
}

const adminFactory = createCallerFactory(adminRouter);
const exportFactory = createCallerFactory(exportRouter);
const feedbackFactory = createCallerFactory(feedbackRouter);
const inviteFactory = createCallerFactory(inviteRouter);

export const trpcAdmin = async (c: BridgeCaller) =>
	adminFactory(await contextFor(c));
export const trpcExport = async (c: BridgeCaller) =>
	exportFactory(await contextFor(c));
export const trpcFeedback = async (c: BridgeCaller) =>
	feedbackFactory(await contextFor(c));
export const trpcInvite = async (c: BridgeCaller) =>
	inviteFactory(await contextFor(c));

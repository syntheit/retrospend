/**
 * The project page for people without an account on it: a guest, a viewer
 * link and the public page. Thin: the access check, then one read from
 * src/server/services/project. Spread into projectRouter.
 */
import { TRPCError } from "@trpc/server";
import {
	assertGuestProjectScope,
	guestOrProtectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { getClientIp, InMemoryRateLimiter } from "~/server/lib/rate-limiter";
import { projectInput } from "~/server/services/project/inputs";
import {
	type PageViewer,
	readProjectPage,
	readSharedProjectPage,
} from "~/server/services/project/page-view";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { requestTimeZone } from "~/server/time-zone";

type Reader = {
	db: Parameters<typeof requireProjectRole>[0];
	participant: Parameters<typeof assertGuestProjectScope>[0];
};

/** Scope check and membership check for any reader: user, guest or viewer link. */
export function assertReader(ctx: Reader, projectId: string) {
	assertGuestProjectScope(ctx.participant, projectId);
	const { participantType: type, participantId } = ctx.participant;
	return requireProjectRole(ctx.db, projectId, type, participantId, "VIEWER");
}

/**
 * Like assertReader, for what shows who owes whom (the summary, the plan,
 * the balances): a viewer link may read the expenses and the total, never the
 * money between people.
 */
export function assertMember(ctx: Reader, projectId: string) {
	if (ctx.participant.participantType === "viewerLink")
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "A viewer link cannot read balances",
		});
	return assertReader(ctx, projectId);
}

/** The public page answers anyone, so one address gets this many reads a minute. */
const PUBLIC_READS_PER_MINUTE = 60;
const publicLimiter = new InMemoryRateLimiter();

export const projectSharedProcedures = {
	/** The page for a guest or a viewer link (a signed-in member gets the full page). */
	sharedPageView: guestOrProtectedProcedure
		.input(projectInput.byId)
		.query(async ({ ctx, input }) => {
			await assertReader(ctx, input.id);
			const { participantType, participantId } = ctx.participant;
			if (participantType === "user")
				return readProjectPage(ctx.db, input.id, participantId, requestTimeZone(ctx.headers));
			const viewer: PageViewer =
				participantType === "guest"
					? { kind: "guest", guestId: participantId }
					: { kind: "link" };
			return readSharedProjectPage(ctx.db, input.id, viewer, requestTimeZone(ctx.headers));
		}),

	/** The public page of a PUBLIC project: no balances, payments or emails. Null for any other project. */
	publicPageView: publicProcedure
		.input(projectInput.byId)
		.query(async ({ ctx, input }) => {
			const clientIp = getClientIp(ctx.headers);
			if (!publicLimiter.check(`publicProject_${clientIp}`, PUBLIC_READS_PER_MINUTE, 60_000))
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Rate limit exceeded",
				});
			const project = await ctx.db.project.findUnique({
				where: { id: input.id },
				select: { visibility: true },
			});
			if (project?.visibility !== "PUBLIC") return null;
			return readSharedProjectPage(
				ctx.db,
				input.id,
				{ kind: "public" },
				requestTimeZone(ctx.headers),
			);
		}),
};

import { z } from "zod";
import { env } from "~/env";
import {
	assertGuestProjectScope,
	assertWritableParticipant,
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { db as globalDb } from "~/server/db";
import { getShadowInviteEmailTemplate } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import { getImageUrl } from "~/server/storage";
import { PeopleService } from "~/server/services/shared-expenses/people.service";

const participantRefSchema = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

export const peopleRouter = createTRPCRouter({
	/**
	 * Search for people to split expenses with.
	 * Returns the user's shadow profiles matching the query,
	 * plus any verified users they've previously transacted with.
	 */
	search: protectedProcedure
		.input(z.object({ query: z.string().min(1).max(100) }))
		.query(async ({ ctx, input }) => {
			const query = input.query.toLowerCase();
			const userId = ctx.session.user.id;

			// Search shadow profiles owned by this user
			const shadows = await ctx.db.shadowProfile.findMany({
				where: {
					createdById: userId,
					claimedById: null,
					OR: [
						{ name: { contains: query, mode: "insensitive" } },
						{ email: { contains: query, mode: "insensitive" } },
					],
				},
				select: { id: true, name: true, email: true },
				take: 10,
			});

			// Contacts: users we've previously transacted with (fuzzy search)
			const contactUserIds = await ctx.db.splitParticipant.findMany({
				where: {
					participantType: "user",
					participantId: { not: userId },
					transaction: {
						splitParticipants: {
							some: {
								participantType: "user",
								participantId: userId,
							},
						},
					},
				},
				select: { participantId: true },
				distinct: ["participantId"],
			});
			const contactIds = new Set(
				contactUserIds.map((c) => c.participantId),
			);

			// Contacts: fuzzy search by name or email
			const contactUsers =
				contactIds.size > 0
					? await ctx.db.user.findMany({
							where: {
								id: { in: [...contactIds] },
								OR: [
									{ name: { contains: query, mode: "insensitive" } },
									{ email: { contains: query, mode: "insensitive" } },
									{ username: { contains: query, mode: "insensitive" } },
								],
							},
							select: { id: true, name: true, username: true, image: true, avatarPath: true },
							take: 10,
						})
					: [];

			// Non-contacts: match by exact username or exact email
			const nonContactUsers = await ctx.db.user.findMany({
				where: {
					id: {
						not: userId,
						...(contactIds.size > 0
							? { notIn: [...contactIds] }
							: {}),
					},
					OR: [
						{ username: { equals: query, mode: "insensitive" } },
						{ email: { equals: query, mode: "insensitive" } },
					],
				},
				select: { id: true, name: true, username: true, image: true, avatarPath: true },
				take: 5,
			});

			const users = [...contactUsers, ...nonContactUsers];

			return {
				shadows: shadows.map((s) => ({
					participantType: "shadow" as const,
					participantId: s.id,
					name: s.name,
					email: s.email,
				})),
				users: users.map((u) => ({
					participantType: "user" as const,
					participantId: u.id,
					name: u.name ?? "Unknown",
					username: u.username ?? null,
					avatarUrl: getImageUrl(u.avatarPath) ?? u.image,
				})),
			};
		}),

	/**
	 * Create a shadow profile for someone who doesn't have a Retrospend account.
	 * Returns the new profile's participant ref.
	 */
	createShadow: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(191),
				email: z.string().email().max(255).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// If email is provided, check if it belongs to an existing user
			if (input.email) {
				const existingUser = await ctx.db.user.findFirst({
					where: { email: { equals: input.email, mode: "insensitive" } },
					select: { id: true, name: true, username: true, image: true, avatarPath: true },
				});
				if (existingUser) {
					return {
						participantType: "user" as const,
						participantId: existingUser.id,
						name: existingUser.name ?? input.name,
						email: input.email,
					};
				}
			}

			const profile = await ctx.db.shadowProfile.create({
				data: {
					name: input.name,
					email: input.email ?? null,
					createdById: ctx.session.user.id,
				},
				select: { id: true, name: true, email: true },
			});

			// Send invitation email to the shadow profile (fire-and-forget)
			if (input.email) {
				const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
				if (appUrl) {
					const signupUrl = `${appUrl}/signup?email=${encodeURIComponent(input.email)}&name=${encodeURIComponent(input.name)}&invited=true`;
					const creatorName = ctx.session.user.name ?? "Someone";
					const html = getShadowInviteEmailTemplate(creatorName, signupUrl);
					void sendEmail(
						input.email,
						`${creatorName} invited you to Retrospend`,
						html,
					);
				}
			}

			return {
				participantType: "shadow" as const,
				participantId: profile.id,
				name: profile.name,
				email: profile.email,
			};
		}),

	/**
	 * Returns the number of shadow profiles claimed by the current user.
	 * Used on the dashboard to show a tailored welcome banner for users
	 * who had shared expenses linked on signup.
	 * Uses global db since RLS on shadow_profile only allows access by createdById.
	 */
	claimedShadowCount: protectedProcedure.query(async ({ ctx }) => {
		return globalDb.shadowProfile.count({
			where: { claimedById: ctx.session.user.id },
		});
	}),

	/**
	 * Returns all people the current user has a shared financial relationship with.
	 *
	 * A relationship exists when there is at least one SharedTransaction where both
	 * the current user and the other person are SplitParticipants.
	 *
	 * Each entry includes: identity info, per-currency net balances, pending
	 * verification count, and most recent transaction date.
	 *
	 * Sorted: nonzero balances first (by absolute value desc), then settled
	 * contacts by most recent transaction date desc.
	 */
	list: protectedProcedure.query(async ({ ctx }) => {
		const service = new PeopleService(ctx.db, {
			participantType: "user",
			participantId: ctx.session.user.id,
		});
		return service.listPeople();
	}),

	/**
	 * Returns full detail for a specific person: identity, net balance, and
	 * paginated transaction history shared with the current user (or guest).
	 *
	 * The participant is identified by type ("user" | "guest" | "shadow") + id,
	 * which maps to: User.id, GuestSession.id, or ShadowProfile.id respectively.
	 *
	 * Supports filtering by status, projectId, and pagination.
	 * Guests must filter by their projectId scope.
	 */
	detail: guestOrProtectedProcedure
		.input(
			participantRefSchema.extend({
				status: z.enum(["active", "pending", "settled"]).optional(),
				projectId: z.string().cuid().optional(),
				page: z.number().int().positive().default(1),
				limit: z.number().int().positive().max(100).default(20),
			}),
		)
		.query(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			// Guests must scope their query to their project
			if (actor.participantType === "guest") {
				const projectId = input.projectId ?? actor.projectScope;
				assertGuestProjectScope(actor, projectId);
			}
			const service = new PeopleService(ctx.db, actor);
			const { participantType, participantId, ...options } = input;
			return service.getPersonDetail(
				{ participantType, participantId },
				options,
			);
		}),

	/**
	 * Cursor-based variant of `detail` for infinite scrolling.
	 * First page returns identity, balances, stats, breakdown + transactions.
	 * Subsequent pages return only transactions + nextCursor.
	 */
	detailCursor: guestOrProtectedProcedure
		.input(
			participantRefSchema.extend({
				limit: z.number().int().positive().max(100).default(30),
				cursor: z.string().optional(),
				projectId: z.string().cuid().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			if (actor.participantType === "guest") {
				const projectId = input.projectId ?? actor.projectScope;
				assertGuestProjectScope(actor, projectId);
			}
			const service = new PeopleService(ctx.db, actor);
			const { participantType, participantId, ...options } = input;
			return service.getPersonDetailCursor(
				{ participantType, participantId },
				options,
			);
		}),

	/**
	 * Returns the top 5 people the current user splits expenses with most frequently.
	 * Excludes the current user and guest participants.
	 */
	frequentSplitPartners: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;

		const userParticipations = await ctx.db.splitParticipant.findMany({
			where: { participantType: "user", participantId: userId },
			select: { transactionId: true },
		});

		if (userParticipations.length === 0) return [];
		const txIds = userParticipations.map((p) => p.transactionId);

		// Group co-participants by frequency (take extra to filter out self in JS)
		const allPartnerGroups = await ctx.db.splitParticipant.groupBy({
			by: ["participantType", "participantId"],
			where: {
				transactionId: { in: txIds },
				participantType: { in: ["user", "shadow"] },
			},
			_count: { transactionId: true },
			orderBy: { _count: { transactionId: "desc" } },
			take: 10,
		});

		const partnerGroups = allPartnerGroups
			.filter(
				(g) => !(g.participantType === "user" && g.participantId === userId),
			)
			.slice(0, 5);

		if (partnerGroups.length === 0) return [];

		const userIds = partnerGroups
			.filter((g) => g.participantType === "user")
			.map((g) => g.participantId);
		const shadowIds = partnerGroups
			.filter((g) => g.participantType === "shadow")
			.map((g) => g.participantId);

		const [users, shadows] = await Promise.all([
			userIds.length > 0
				? ctx.db.user.findMany({
						where: { id: { in: userIds } },
						select: {
							id: true,
							name: true,
							username: true,
							image: true,
							avatarPath: true,
						},
					})
				: Promise.resolve([]),
			shadowIds.length > 0
				? ctx.db.shadowProfile.findMany({
						where: { id: { in: shadowIds }, createdById: userId },
						select: { id: true, name: true, email: true },
					})
				: Promise.resolve([]),
		]);

		const userMap = new Map(users.map((u) => [u.id, u]));
		const shadowMap = new Map(shadows.map((s) => [s.id, s]));

		return partnerGroups
			.map((g) => {
				if (g.participantType === "user") {
					const u = userMap.get(g.participantId);
					if (!u) return null;
					return {
						participantType: "user" as const,
						participantId: g.participantId,
						name: u.name ?? "Unknown",
						email: null as string | null,
						username: u.username ?? null,
						avatarUrl: getImageUrl(u.avatarPath) ?? u.image ?? null,
					};
				}
				const s = shadowMap.get(g.participantId);
				if (!s) return null;
				return {
					participantType: "shadow" as const,
					participantId: g.participantId,
					name: s.name,
					email: s.email,
					username: null as string | null,
					avatarUrl: null as string | null,
				};
			})
			.filter((p): p is NonNullable<typeof p> => p !== null);
	}),

	/**
	 * Lightweight endpoint returning only the net balance between the current
	 * participant and the specified person.
	 *
	 * Returns one entry per currency: no cross-currency netting is performed.
	 * An empty array means the balance is fully settled across all currencies.
	 *
	 * Guests may only query balances for participants within their project scope.
	 */
	balance: guestOrProtectedProcedure
		.input(participantRefSchema)
		.query(async ({ ctx, input }) => {
			const actor = assertWritableParticipant(ctx.participant);
			// Enforce guest project scope for defence-in-depth
			if (actor.participantType === "guest") {
				assertGuestProjectScope(actor, actor.projectScope);
			}
			const service = new PeopleService(ctx.db, actor);
			return service.getBalance(input);
		}),
});

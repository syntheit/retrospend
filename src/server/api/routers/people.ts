import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getImageUrl } from "~/server/storage";
import { addShadow, assertEmailCheck, renameShadow } from "~/server/services/shadow-profile.service";
import { frequentSplitPartners } from "~/server/services/people/frequent-partners";
import { buildContactVisibility } from "~/server/services/shared-expenses/contact-visibility";
import { PeopleService } from "~/server/services/shared-expenses/people.service";
import { peopleV2Procedures } from "./people-v2";

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

			// Search shadow profiles visible to this user: ones they created plus
			// ones that share a project with them. The shadow_profile RLS policy
			// enforces this scope at the DB layer (creator OR shared project), so we
			// do NOT filter by createdById here, that would hide project ghosts
			// created by other members. Private (non-project) shadows of unrelated
			// users are never returned because RLS excludes them.
			//
			// Being able to see a ghost doesn't mean seeing its email: that follows
			// the shared contact rule (creator, or EDITOR+ in one of its projects).
			// So match on email only for ghosts whose email the caller may see,
			// otherwise a substring search would leak the address bit by bit.
			const candidates = await ctx.db.shadowProfile.findMany({
				where: {
					claimedById: null,
					OR: [
						{ name: { contains: query, mode: "insensitive" } },
						{ email: { contains: query, mode: "insensitive" } },
					],
				},
				select: { id: true, name: true, email: true },
				take: 50,
			});
			const contactVisible = await buildContactVisibility(
				ctx.db,
				{ participantType: "user", participantId: userId },
				candidates.map((s) => ({
					participantType: "shadow",
					participantId: s.id,
				})),
			);
			const shadows = candidates
				.map((s) => ({
					...s,
					email: contactVisible({ participantType: "shadow", participantId: s.id })
						? s.email
						: null,
				}))
				.filter(
					(s) =>
						s.name.toLowerCase().includes(query) ||
						(s.email?.toLowerCase().includes(query) ?? false),
				)
				.slice(0, 10);

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

	/** Adds a person by name; an email is metered and reveals an account only if you share with it. */
	createShadow: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(191),
				email: z.email().max(255).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.email) await assertEmailCheck(ctx.session.user.id);
			const result = await addShadow(
				ctx.db,
				{ id: ctx.session.user.id, name: ctx.session.user.name ?? null },
				input,
				"protect",
			);
			if (result.kind === "account") {
				return {
					participantType: "user" as const,
					participantId: result.userId,
					name: result.name ?? input.name,
					email: input.email ?? null,
				};
			}
			return {
				participantType: "shadow" as const,
				participantId: result.id,
				name: result.name,
				email: result.email,
			};
		}),

	/**
	 * Rename (and optionally re-email) a shadow profile, the "ghost" someone set
	 * up to track a person without an account.
	 *
	 * Authorized exactly like claim.generateLink: the shadow is read through the
	 * user-scoped ctx.db (RLS ensures the caller can already see it), an already
	 * claimed shadow is off-limits (its identity now belongs to a real account),
	 * and the caller must be the shadow's creator OR an EDITOR+ of at least one
	 * project the shadow participates in. A standalone (project-less) shadow can
	 * only be edited by its creator. The write goes through ctx.db so RLS applies.
	 */
	updateShadow: protectedProcedure
		.input(
			z.object({
				shadowId: z.string().min(1),
				name: z.string().min(1).max(191),
				email: z.email().max(255).optional(),
			}),
		)
		.mutation(({ ctx, input }) =>
			renameShadow(ctx.db, ctx.session.user.id, {
				id: input.shadowId,
				name: input.name,
				email: input.email,
			}),
		),

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
	 * Returns the top 5 people the current user splits expenses with most frequently.
	 * Excludes the current user and guest participants.
	 */
	frequentSplitPartners: protectedProcedure.query(({ ctx }) =>
		frequentSplitPartners(ctx.db, ctx.session.user.id),
	),
	...peopleV2Procedures,

});

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";

const participantRefSchema = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

const methodInputSchema = z.object({
	id: z.string().optional(),
	type: z.string().min(1).max(50),
	label: z.string().max(100).optional(),
	identifier: z.string().max(500).optional(),
	rank: z.number().int().min(1),
	visibility: z.enum(["PUBLIC", "FRIENDS_ONLY", "PAYMENT_ONLY"]),
	minAmount: z.number().positive().optional(),
	currency: z.string().max(10).optional(),
	network: z.string().max(50).optional(),
});

export const paymentMethodRouter = createTRPCRouter({
	/**
	 * Returns all payment methods for the current user, ordered by rank ascending.
	 */
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db.paymentMethod.findMany({
			where: { userId: ctx.session.user.id },
			orderBy: { rank: "asc" },
		});
	}),

	/**
	 * Bulk upsert: the frontend sends the entire (possibly reordered) list at once.
	 * Ranks are re-normalized to be sequential starting from 1.
	 * Methods not present in the input are deleted.
	 */
	upsert: protectedProcedure
		.input(z.object({ methods: z.array(methodInputSchema) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Re-normalize ranks to sequential starting at 1
			const methods = input.methods.map((m, i) => ({ ...m, rank: i + 1 }));
			const inputIds = methods.filter((m) => m.id).map((m) => m.id!);

			await ctx.db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true), set_config('role', 'retrospend_app', true)`;

				// Delete methods not present in the input
				if (inputIds.length > 0) {
					await tx.paymentMethod.deleteMany({
						where: { userId, NOT: { id: { in: inputIds } } },
					});
				} else {
					await tx.paymentMethod.deleteMany({ where: { userId } });
				}

				// Update or create each method
				for (const method of methods) {
					const data = {
						type: method.type,
						label: method.label ?? null,
						identifier: method.identifier ?? null,
						rank: method.rank,
						visibility: method.visibility,
						minAmount:
							method.minAmount != null ? String(method.minAmount) : null,
						currency: method.currency ?? null,
						network: method.network ?? null,
					};

					if (method.id) {
						await tx.paymentMethod.update({
							where: { id: method.id },
							data,
						});
					} else {
						await tx.paymentMethod.create({
							data: { userId, ...data },
						});
					}
				}

				// Log the change
				await tx.eventLog.create({
					data: {
						eventType: "SETTINGS_UPDATED",
						userId,
						metadata: { section: "payment_methods", count: methods.length },
					},
				});
			});

			return { success: true };
		}),

	/**
	 * Given a participant ref, computes the ranked list of compatible payment methods
	 * between the current user and that participant.
	 *
	 * Only verified users (participantType = "user") can have payment methods.
	 * For crypto, compatibility requires matching currency + network.
	 * Results are ranked by combined score (sum of both ranks, lower = better).
	 */
	match: protectedProcedure
		.input(participantRefSchema)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const yourMethods = await ctx.db.paymentMethod.findMany({
				where: { userId },
				orderBy: { rank: "asc" },
			});

			// Only verified Users have payment methods
			if (input.participantType !== "user") {
				return { compatible: [], yourMethods, theirMethods: [] };
			}

			const otherUserId = input.participantId;

			// Check for a financial relationship before exposing non-PUBLIC methods.
			// FRIENDS_ONLY and PAYMENT_ONLY identifiers (bank accounts, wallet
			// addresses, etc.) must only be visible to users with a shared
			// transaction history: same rule enforced by paymentMethod.getForUser.
			const relationship = await ctx.db.splitParticipant.findFirst({
				where: {
					participantType: "user",
					participantId: userId,
					transaction: {
						splitParticipants: {
							some: { participantType: "user", participantId: otherUserId },
						},
					},
				},
				select: { id: true },
			});
			const hasRelationship = !!relationship;

			// Fetch other user's methods using global db (bypasses RLS: we apply
			// app-level visibility filtering below)
			const theirAllMethods = await db.paymentMethod.findMany({
				where: { userId: otherUserId },
				orderBy: { rank: "asc" },
			});

			const theirMethods = theirAllMethods.filter(
				(m) =>
					m.visibility === "PUBLIC" ||
					(hasRelationship &&
						(m.visibility === "FRIENDS_ONLY" ||
							m.visibility === "PAYMENT_ONLY")),
			);

			type CompatibleMethod = {
				type: string;
				label: string | null;
				theirIdentifier: string | null;
				yourRank: number;
				theirRank: number;
				combinedScore: number;
			};

			const compatible: CompatibleMethod[] = [];

			for (const yours of yourMethods) {
				for (const theirs of theirMethods) {
					if (yours.type !== theirs.type) continue;

					// For crypto, also require matching currency and network
					if (yours.type === "crypto") {
						const currencyMatch =
							!yours.currency ||
							!theirs.currency ||
							yours.currency.toUpperCase() === theirs.currency.toUpperCase();
						const networkMatch =
							!yours.network ||
							!theirs.network ||
							yours.network.toLowerCase() === theirs.network.toLowerCase();
						if (!currencyMatch || !networkMatch) continue;
					}

					compatible.push({
						type: yours.type,
						label: theirs.label ?? yours.label,
						theirIdentifier: theirs.identifier,
						yourRank: yours.rank,
						theirRank: theirs.rank,
						combinedScore: yours.rank + theirs.rank,
					});
				}
			}

			// Sort by combined score; tie-break by current user's rank
			compatible.sort((a, b) =>
				a.combinedScore !== b.combinedScore
					? a.combinedScore - b.combinedScore
					: a.yourRank - b.yourRank,
			);

			return { compatible, yourMethods, theirMethods };
		}),

	/**
	 * Returns another user's payment methods filtered by visibility.
	 * Used by the Person Detail page sidebar (Chunk 3B).
	 *
	 * Financial relationship exists → show PUBLIC + FRIENDS_ONLY + PAYMENT_ONLY.
	 * No relationship → show only PUBLIC.
	 */
	getForUser: protectedProcedure
		.input(z.object({ userId: z.string() }))
		.query(async ({ ctx, input }) => {
			const currentUserId = ctx.session.user.id;

			// Check for a financial relationship (split_participant has no RLS,
			// so ctx.db can see all participants under retrospend_app role)
			const relationship = await ctx.db.splitParticipant.findFirst({
				where: {
					participantType: "user",
					participantId: currentUserId,
					transaction: {
						splitParticipants: {
							some: {
								participantType: "user",
								participantId: input.userId,
							},
						},
					},
				},
				select: { id: true },
			});

			const hasRelationship = !!relationship;

			// Fetch with global db (bypasses RLS)
			const allMethods = await db.paymentMethod.findMany({
				where: { userId: input.userId },
				orderBy: { rank: "asc" },
			});

			return allMethods.filter((m) => {
				if (m.visibility === "PUBLIC") return true;
				if (
					hasRelationship &&
					(m.visibility === "FRIENDS_ONLY" || m.visibility === "PAYMENT_ONLY")
				)
					return true;
				return false;
			});
		}),
});

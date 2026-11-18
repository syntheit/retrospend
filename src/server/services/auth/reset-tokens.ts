/**
 * Password reset links: the one owner of how one is made, stored, found,
 * spent and limited (E2EE K3-0; docs/roadmap/e2ee-k1-k3.md, "After the
 * critic" 2). Every path goes through here: the reset request, the reset
 * step, the admin's link, the email change, the password writers and, later,
 * the recovery routes and the phone's code.
 *
 * - The table holds the SHA-256 of the token (`hashToken`); the raw token
 *   lives only in the email or the admin's screen.
 * - A token resolves to its user id, never through an address, so an address
 *   change moves nothing to whoever takes the old one.
 * - A link is spent with one conditional delete (token, user, origin, expiry),
 *   so it works once and two concurrent uses cannot both win.
 * - `origin` says who made the link. An admin link resets a password like any
 *   other but never opens recovery (`resolveRecoveryToken`).
 * - A new request keeps the earlier live links (a stranger who knows an
 *   address cannot cancel a reset in progress) and is limited per address.
 *
 * The table is closed to retrospend_app: this runs on the owner connection.
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { db } from "~/server/db";
import { hashToken } from "~/server/lib/tokens";
import { consumeRateLimit } from "../api-v1/rate-limit.service";
import { normalizeEmail } from "../protection-keys/prelogin";

export const RESET_TOKEN_ORIGINS = ["email", "admin"] as const;
export type ResetTokenOrigin = (typeof RESET_TOKEN_ORIGINS)[number];

/** A link lives an hour. The sidecar purge deletes by this column's date. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;
/** Live links one user may hold per origin; a newer one pushes out the oldest. */
export const LIVE_LINKS_PER_ORIGIN = 3;
/** Reset requests one address may make: the stranger's brake, not the person's. */
export const RESET_REQUESTS_PER_ADDRESS = {
	limit: 3,
	windowMs: 60 * 60 * 1000,
} as const;

type Client = Pick<Prisma.TransactionClient, "passwordResetToken">;

/** The token is unknown, expired, spent or not the user's. One answer for all. */
export class InvalidResetTokenError extends TRPCError {
	constructor() {
		super({ code: "NOT_FOUND", message: "Invalid or expired token" });
	}
}

const isOrigin = (value: string): value is ResetTokenOrigin =>
	(RESET_TOKEN_ORIGINS as readonly string[]).includes(value);

/**
 * Makes a link for the user and returns the raw token (for the email or the
 * admin's screen). Expired links of the user are swept, and the user's links
 * of this origin are trimmed to `LIVE_LINKS_PER_ORIGIN` including the new one.
 * A per-user advisory lock keeps two requests from both missing the trim.
 */
export async function issueResetToken(input: {
	userId: string;
	origin: ResetTokenOrigin;
	now?: Date;
}): Promise<string> {
	const now = input.now ?? new Date();
	const token = randomBytes(32).toString("hex");
	await db.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reset-link:${input.userId}`}, 0))`;
		await tx.passwordResetToken.deleteMany({
			where: { userId: input.userId, expires: { lte: now } },
		});
		const surplus = await tx.passwordResetToken.findMany({
			where: { userId: input.userId, origin: input.origin },
			orderBy: { expires: "desc" },
			skip: LIVE_LINKS_PER_ORIGIN - 1,
			select: { token: true },
		});
		if (surplus.length > 0)
			await tx.passwordResetToken.deleteMany({
				where: { token: { in: surplus.map((row) => row.token) } },
			});
		await tx.passwordResetToken.create({
			data: {
				token: hashToken(token),
				userId: input.userId,
				origin: input.origin,
				expires: new Date(now.getTime() + RESET_LINK_TTL_MS),
			},
		});
	});
	return token;
}

/**
 * The user and origin a live token belongs to, or null. Looks up by hash
 * only, so a stored value is never a token. Spending is a separate step
 * (`spendResetToken`), in the transaction that writes the password.
 */
export async function lookupResetToken(
	token: string,
	now: Date = new Date(),
): Promise<{ userId: string; origin: ResetTokenOrigin } | null> {
	const row = await db.passwordResetToken.findFirst({
		where: { token: hashToken(token), expires: { gt: now } },
		select: { userId: true, origin: true },
	});
	// An origin the code does not know is refused, never read as "email".
	if (!row || !isOrigin(row.origin)) return null;
	return { userId: row.userId, origin: row.origin };
}

/**
 * The user a token may open recovery for: only a link the person asked for
 * by email. An admin link, an unknown, expired or spent token is null, which
 * the recovery routes answer as 404 like any unknown token.
 */
export async function resolveRecoveryToken(
	token: string,
	now: Date = new Date(),
): Promise<{ userId: string } | null> {
	const found = await lookupResetToken(token, now);
	if (!found || found.origin !== "email") return null;
	return { userId: found.userId };
}

/**
 * Spends the token in the caller's transaction: one conditional delete keyed
 * by token hash, user id, expiry and (when given) origin. Anything but exactly
 * one row throws, so the caller's transaction rolls back and nothing it wrote
 * stays; two concurrent uses of one token give one success and one refusal.
 */
export async function spendResetToken(
	tx: Client,
	input: {
		token: string;
		userId: string;
		origin?: ResetTokenOrigin;
		now?: Date;
	},
): Promise<void> {
	const spent = await tx.passwordResetToken.deleteMany({
		where: {
			token: hashToken(input.token),
			userId: input.userId,
			expires: { gt: input.now ?? new Date() },
			...(input.origin ? { origin: input.origin } : {}),
		},
	});
	if (spent.count !== 1) throw new InvalidResetTokenError();
}

/**
 * Removes every link of the user, in the caller's transaction: after the
 * password changed or the keys were made or rotated, an older link would write
 * a hash around them. Also used when the address changes.
 */
export async function deleteUserResetTokens(
	tx: Client,
	userId: string,
): Promise<void> {
	await tx.passwordResetToken.deleteMany({ where: { userId } });
}

/**
 * Counts one reset request for an address and says whether it fits. The key is
 * a hash of the normalized address, so the counter table never holds it, and
 * it counts known and unknown addresses alike, so the limit proves nothing
 * about whether an account exists.
 */
export async function allowResetRequest(
	email: string,
	now: Date = new Date(),
): Promise<boolean> {
	const decision = await consumeRateLimit(
		`reset:address:${hashToken(normalizeEmail(email))}`,
		RESET_REQUESTS_PER_ADDRESS.limit,
		RESET_REQUESTS_PER_ADDRESS.windowMs,
		now,
	);
	return decision.allowed;
}

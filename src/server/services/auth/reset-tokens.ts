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
 * - A new request keeps every earlier live link of the person (a stranger who
 *   knows an address cannot cancel a reset in progress; no count of links
 *   trims one, only expiry removes it) and is limited per address.
 * - A link is made under the user's row lock and only for the address that is
 *   still the account's, so an address change that commits first leaves the
 *   old address nothing, and one that follows deletes the link.
 *
 * The table is closed to retrospend_app: this runs on the owner connection.
 */
import { createHmac, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { env } from "~/env";
import { db } from "~/server/db";
import { hashToken } from "~/server/lib/tokens";
import { consumeRateLimit } from "../api-v1/rate-limit.service";
import { normalizeEmail } from "../protection-keys/prelogin";

export const RESET_TOKEN_ORIGINS = ["email", "admin"] as const;
export type ResetTokenOrigin = (typeof RESET_TOKEN_ORIGINS)[number];

/** A link lives an hour. The sidecar purge deletes by this column's date. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;
/**
 * Live admin links one user may hold; a newer one pushes out the oldest. Links
 * the person asked for are never trimmed by count: the address limit bounds
 * them, and a count would let three requests from a stranger in the next limit
 * window push out the person's own link (the window and the link's life are
 * both an hour but do not line up).
 */
export const LIVE_ADMIN_LINKS = 3;
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
 * Locks the user's row until the transaction ends and returns the address it
 * holds now, or null when the user is gone. Whoever changes an account's
 * address takes this lock before the change (`applyConfirmedEmail`, the
 * immediate change in `updateProfile`), and `issueResetToken` takes it to
 * check the address it mails, so the two can never interleave.
 */
export async function lockUserRow(
	tx: Pick<Prisma.TransactionClient, "$queryRaw">,
	userId: string,
): Promise<string | null> {
	const [row] = await tx.$queryRaw<{ email: string }[]>`
		SELECT "email" FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
	return row?.email ?? null;
}

/**
 * Makes a link for the user and returns the raw token (for the email or the
 * admin's screen), or null when `forEmail` is no longer the account's address
 * (it changed after the caller read it): nothing is written then. Expired
 * links of the user are swept; admin links are trimmed to `LIVE_ADMIN_LINKS`
 * including the new one. A per-user advisory lock keeps two requests from both
 * missing the trim.
 */
export async function issueResetToken(input: {
	userId: string;
	origin: ResetTokenOrigin;
	forEmail: string;
	now?: Date;
}): Promise<string | null> {
	const now = input.now ?? new Date();
	const token = randomBytes(32).toString("hex");
	const issued = await db.$transaction(async (tx) => {
		if ((await lockUserRow(tx, input.userId)) !== input.forEmail) return false;
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reset-link:${input.userId}`}, 0))`;
		await tx.passwordResetToken.deleteMany({
			where: { userId: input.userId, expires: { lte: now } },
		});
		if (input.origin === "admin") {
			const surplus = await tx.passwordResetToken.findMany({
				where: { userId: input.userId, origin: "admin" },
				orderBy: { expires: "desc" },
				skip: LIVE_ADMIN_LINKS - 1,
				select: { token: true },
			});
			if (surplus.length > 0)
				await tx.passwordResetToken.deleteMany({
					where: { token: { in: surplus.map((row) => row.token) } },
				});
		}
		await tx.passwordResetToken.create({
			data: {
				token: hashToken(token),
				userId: input.userId,
				origin: input.origin,
				expires: new Date(now.getTime() + RESET_LINK_TTL_MS),
			},
		});
		return true;
	});
	return issued ? token : null;
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

let addressKey: Buffer | undefined;
/**
 * The limiter's key for an address: an HMAC of the normalized address under a
 * key derived from the auth secret and used for nothing else, so the counter
 * table (and a backup of it) does not reveal who asked for a reset, and cannot
 * be checked against a list of addresses without the secret.
 */
export function resetAddressKey(email: string): string {
	addressKey ??= createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update("reset-request-address")
		.digest();
	return `reset:address:${createHmac("sha256", addressKey)
		.update(normalizeEmail(email))
		.digest("hex")}`;
}

/**
 * Counts one reset request for an address and says whether it fits. The key is
 * keyed and hashed (`resetAddressKey`), and the count covers known and unknown
 * addresses alike, so the limit proves nothing about whether an account exists.
 */
export async function allowResetRequest(
	email: string,
	now: Date = new Date(),
): Promise<boolean> {
	const decision = await consumeRateLimit(
		resetAddressKey(email),
		RESET_REQUESTS_PER_ADDRESS.limit,
		RESET_REQUESTS_PER_ADDRESS.windowMs,
		now,
	);
	return decision.allowed;
}

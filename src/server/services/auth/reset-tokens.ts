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
 * - The phone's reset code (K3-5a) is the same table and the same owner. A
 *   code is 8 Crockford characters (40 bits), lives 15 minutes and is found by
 *   address plus code. It is stored as a keyed hash bound to its own row id and
 *   user (`codeDigest`), never in the clear, and it is not a bearer token: a
 *   typed code is swapped (`redeemResetCode`, one transaction) for a "phone"
 *   token that opens recovery and never the plain reset. Each try at a code
 *   costs one of 5 an hour per user across every live code, so asking for
 *   another code adds none.
 * - Which origins may do what is in the three lists below
 *   (`PLAIN_RESET_ORIGINS`, `RECOVERY_ORIGINS`, and `LINK_ORIGINS` for what
 *   `issueResetToken` makes). `lookupResetToken` and `spendResetToken` take the
 *   list as a required argument, so a caller cannot forget to say which.
 *
 * The table is closed to retrospend_app: this runs on the owner connection.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
	CROCKFORD_ALPHABET,
	RESET_CODE_LENGTH,
	readResetCode,
} from "@retrospend/crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { db } from "~/server/db";
import { keyedHash } from "~/server/lib/keyed-hash";
import { hashToken } from "~/server/lib/tokens";
import { consumeRateLimit } from "../api-v1/rate-limit.service";
import { normalizeEmail } from "../protection-keys/prelogin";

/**
 * Who made a row. email: the person asked for a link. admin: an admin made
 * one. phone: a redeemed code's recovery token. code: the code's own row,
 * which is compared against and never sent as a token (see `BearerOrigin`).
 */
export const RESET_TOKEN_ORIGINS = ["email", "admin", "phone", "code"] as const;
export type ResetTokenOrigin = (typeof RESET_TOKEN_ORIGINS)[number];
/** The origins of a token a person holds and sends: every one but a code's row. */
export type BearerOrigin = Exclude<ResetTokenOrigin, "code">;
/** What `issueResetToken` makes. A phone token comes only from a redeemed code. */
export const LINK_ORIGINS = ["email", "admin"] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];
/** The plain password reset: a link, never a phone token. */
export const PLAIN_RESET_ORIGINS = ["email", "admin"] as const satisfies readonly BearerOrigin[];
/** Recovery with the recovery key: the person's own link or a redeemed code, never an admin's. */
export const RECOVERY_ORIGINS = ["email", "phone"] as const satisfies readonly BearerOrigin[];

/** A link lives an hour. The sidecar purge deletes by this column's date. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;
/** A phone reset code, and the recovery token it is swapped for, live 15 minutes. */
export const RESET_CODE_TTL_MS = 15 * 60 * 1000;
/** Tries at a code: the guessing limit, per user across every live code. */
export const RESET_CODE_TRIES = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
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

/** The caller used its tries at a code; `retryAfterSeconds` says when to come back. */
export class ResetCodeTriesExceededError extends TRPCError {
	constructor(readonly retryAfterSeconds: number) {
		super({
			code: "TOO_MANY_REQUESTS",
			message: "Too many tries. Try again later.",
		});
	}
}

const isBearerOrigin = (value: string): value is BearerOrigin =>
	(RESET_TOKEN_ORIGINS as readonly string[]).includes(value) && value !== "code";

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
	origin: LinkOrigin;
	forEmail: string;
	now?: Date;
}): Promise<string | null> {
	const now = input.now ?? new Date();
	const token = randomBytes(32).toString("hex");
	const issued = await db.$transaction(async (tx) => {
		if (!(await lockIssuing(tx, input.userId, input.forEmail, now)))
			return false;
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
 * The start of every write that adds a secret for a user: the user's row lock
 * (false when the address is no longer `forEmail`), a per-user advisory lock
 * so two requests cannot both miss a trim, and, when `sweepAt` is given, a
 * sweep of the user's rows expired by then. The sweep is hygiene for the
 * writers that add a row; it is no expiry guard, and redeeming a code passes
 * none so that the compare filter stays the one guard there.
 */
async function lockIssuing(
	tx: Prisma.TransactionClient,
	userId: string,
	forEmail: string,
	sweepAt?: Date,
): Promise<boolean> {
	if ((await lockUserRow(tx, userId)) !== forEmail) return false;
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`reset-link:${userId}`}, 0))`;
	if (sweepAt)
		await tx.passwordResetToken.deleteMany({
			where: { userId, expires: { lte: sweepAt } },
		});
	return true;
}

/**
 * The user and origin a live token of one of `origins` belongs to, or null.
 * Looks up by hash only, so a stored value is never a token, and a code's row
 * is never found here (its origin is not a bearer origin). Spending is a
 * separate step (`spendResetToken`), in the transaction that writes the
 * password.
 */
export async function lookupResetToken(
	token: string,
	origins: readonly BearerOrigin[],
	now: Date = new Date(),
): Promise<{ userId: string; origin: BearerOrigin } | null> {
	const row = await db.passwordResetToken.findFirst({
		where: {
			token: hashToken(token),
			expires: { gt: now },
			origin: { in: [...origins] },
		},
		select: { userId: true, origin: true },
	});
	// An origin the code does not know is refused, never read as "email".
	if (!row || !isBearerOrigin(row.origin)) return null;
	return { userId: row.userId, origin: row.origin };
}

/** `lookupResetToken` for the plain password reset: a link, never a phone token. */
export const lookupPlainResetToken = (token: string, now?: Date) =>
	lookupResetToken(token, PLAIN_RESET_ORIGINS, now);

/**
 * The user a token may open recovery for: a link the person asked for by
 * email or a redeemed code's token (`RECOVERY_ORIGINS`). An admin link, an
 * unknown, expired or spent token is null, which the recovery routes answer as
 * 404 like any unknown token.
 */
export async function resolveRecoveryToken(
	token: string,
	now: Date = new Date(),
): Promise<{ userId: string } | null> {
	const found = await lookupResetToken(token, RECOVERY_ORIGINS, now);
	return found ? { userId: found.userId } : null;
}

/**
 * Spends the token in the caller's transaction: one conditional delete keyed
 * by token hash, user id, expiry and one of `origins`. Anything but exactly
 * one row throws, so the caller's transaction rolls back and nothing it wrote
 * stays; two concurrent uses of one token give one success and one refusal.
 */
export async function spendResetToken(
	tx: Client,
	input: {
		token: string;
		userId: string;
		origins: readonly BearerOrigin[];
		now?: Date;
	},
): Promise<void> {
	const spent = await tx.passwordResetToken.deleteMany({
		where: {
			token: hashToken(input.token),
			userId: input.userId,
			expires: { gt: input.now ?? new Date() },
			origin: { in: [...input.origins] },
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
 * The limiter's key for an address: a keyed hash of the normalized address
 * (lib/keyed-hash.ts), so the counter table (and a backup of it) does not
 * reveal who asked for a reset.
 */
export const resetAddressKey = (email: string): string =>
	`reset:address:${keyedHash("resetAddress", normalizeEmail(email))}`;

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

/** 8 Crockford characters from 40 random bits. */
function newResetCode(): string {
	const bits = randomBytes(5).readUIntBE(0, 5);
	let code = "";
	for (let i = RESET_CODE_LENGTH - 1; i >= 0; i--)
		code += CROCKFORD_ALPHABET.charAt(Math.floor(bits / 32 ** i) % 32);
	return code;
}

/** The code as people read it: two groups of four. */
export const groupResetCode = (code: string): string =>
	`${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * What a code is stored as: a keyed hash of its own row id, the user and the
 * code (keyed-hash.ts), so two rows with one code differ and a read of the
 * table cannot be checked against all 2^40 codes without the server secret.
 */
const codeDigest = (rowId: string, userId: string, code: string): string =>
	keyedHash("resetCode", `${rowId}|${userId}|${code}`);

const sameDigest = (a: string, b: string): boolean =>
	a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Makes a phone reset code for the user and returns it (for the email), or
 * null when `forEmail` is no longer the account's address. Earlier live codes
 * stay valid (a stranger who knows an address cannot cancel the person's code);
 * the per-address request limit and the 15-minute life bound how many exist.
 */
export async function issueResetCode(input: {
	userId: string;
	forEmail: string;
	now?: Date;
}): Promise<string | null> {
	const now = input.now ?? new Date();
	const code = newResetCode();
	const rowId = randomBytes(16).toString("hex");
	const issued = await db.$transaction(async (tx) => {
		if (!(await lockIssuing(tx, input.userId, input.forEmail, now)))
			return false;
		await tx.passwordResetToken.create({
			data: {
				token: rowId,
				userId: input.userId,
				origin: "code",
				codeHash: codeDigest(rowId, input.userId, code),
				expires: new Date(now.getTime() + RESET_CODE_TTL_MS),
			},
		});
		return true;
	});
	return issued ? code : null;
}

/**
 * Where a try at a code is counted: the user's own bucket for a known address
 * and an address bucket for an unknown one, with the same limit, so the 429
 * comes after the same number of tries either way and says nothing about
 * whether an account exists.
 */
const codeTryKey = (userId: string | undefined, address: string): string =>
	userId
		? `reset-code:user:${userId}`
		: `reset-code:address:${keyedHash("resetAddress", address)}`;

/**
 * Swaps a typed code for a recovery token, or throws `InvalidResetTokenError`
 * (an unknown address, no live code, a wrong, expired or used code: one
 * answer) or `ResetCodeTriesExceededError`. Order: count the try, then compare
 * (the proof is the code, so nothing is compared before it is paid for), then
 * one transaction that spends the code with a conditional delete, drops the
 * user's other codes and earlier phone tokens, and makes the phone token. The
 * token is returned raw; it opens recovery only (`RECOVERY_ORIGINS`), and the
 * plain reset refuses it (`PLAIN_RESET_ORIGINS`). An unknown address runs the
 * same steps against no user, so the work is the same.
 */
export async function redeemResetCode(input: {
	email: string;
	code: string;
	now?: Date;
}): Promise<string> {
	const now = input.now ?? new Date();
	const address = normalizeEmail(input.email);
	const user = await db.user.findUnique({
		where: { email: address },
		select: { id: true, email: true },
	});
	const decision = await consumeRateLimit(
		codeTryKey(user?.id, address),
		RESET_CODE_TRIES.limit,
		RESET_CODE_TRIES.windowMs,
		now,
	);
	if (!decision.allowed)
		throw new ResetCodeTriesExceededError(decision.retryAfterSeconds);

	const typed = readResetCode(input.code) ?? "";
	// The one expiry guard of a redeem: an expired code is never compared. The
	// spend below does not repeat it (one `now`, so it could never differ).
	const rows = await db.passwordResetToken.findMany({
		where: { userId: user?.id ?? "", origin: "code", expires: { gt: now } },
		select: { token: true, codeHash: true },
	});
	// Every live code is compared, none stops the loop, and a user with none
	// still computes one digest: the work does not say which case this was.
	let match: { token: string; codeHash: string } | null = null;
	if (rows.length === 0) codeDigest("", user?.id ?? "", typed);
	for (const row of rows) {
		const digest = codeDigest(row.token, user?.id ?? "", typed);
		if (typed && row.codeHash && sameDigest(digest, row.codeHash))
			match = { token: row.token, codeHash: row.codeHash };
	}
	if (!user || !match) throw new InvalidResetTokenError();
	const hit = match;

	const token = randomBytes(32).toString("hex");
	await db.$transaction(async (tx) => {
		if (!(await lockIssuing(tx, user.id, user.email)))
			throw new InvalidResetTokenError();
		const spent = await tx.passwordResetToken.deleteMany({
			where: {
				token: hit.token,
				userId: user.id,
				origin: "code",
				codeHash: hit.codeHash,
			},
		});
		if (spent.count !== 1) throw new InvalidResetTokenError();
		await tx.passwordResetToken.deleteMany({
			where: { userId: user.id, origin: { in: ["code", "phone"] } },
		});
		await tx.passwordResetToken.create({
			data: {
				token: hashToken(token),
				userId: user.id,
				origin: "phone",
				expires: new Date(now.getTime() + RESET_CODE_TTL_MS),
			},
		});
	});
	return token;
}

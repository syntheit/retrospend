import type {
	AccessTokenDto,
	CursorQuery,
	Scope,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { apiKeyScopes } from "~/server/api/v1/scopes";
import { auth } from "~/server/better-auth";
import type { db as globalDb } from "~/server/db";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";
import type { Principal } from "./principal.service";

type UserDb = typeof globalDb;

const DAY_SECONDS = 86_400;

/**
 * Personal access tokens (better-auth api-key rows) for Settings >
 * Developer and /api/v1/tokens. Rows are read and revoked through the
 * user-scoped client (RLS on apikey); creating one goes through the plugin,
 * which hashes the key and owns the INSERT grant.
 */

type ApikeyRow = Awaited<ReturnType<UserDb["apikey"]["findFirstOrThrow"]>>;

function parsePermissions(raw: string | null): Record<string, string[]> | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Record<string, string[]>;
	} catch {
		return null;
	}
}

export function toAccessToken(row: ApikeyRow): AccessTokenDto {
	return {
		id: row.id,
		name: row.name ?? "",
		start: row.start,
		scopes: apiKeyScopes(parsePermissions(row.permissions)),
		enabled: row.enabled ?? true,
		createdAt: row.createdAt.toISOString(),
		expiresAt: row.expiresAt?.toISOString() ?? null,
		lastUsedAt: row.lastRequest?.toISOString() ?? null,
	};
}

/** Newest first (ties by id), starting after `after`. */
export function listAccessTokens(
	db: UserDb,
	userId: string,
	page: { after: { createdAt: Date; id: string } | null; take: number },
) {
	const { after } = page;
	return db.apikey.findMany({
		where: {
			referenceId: userId,
			...(after
				? {
						OR: [
							{ createdAt: { lt: after.createdAt } },
							{ createdAt: after.createdAt, id: { lt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: page.take,
	});
}

/**
 * Token management belongs to the web app's own session. Any other
 * credential (a read token included) may not see which tokens exist.
 */
function assertWebSession(principal: Principal, message: string) {
	if (principal.kind !== "web") {
		throw new TRPCError({ code: "FORBIDDEN", message });
	}
}

/**
 * Creates a token for the caller. Only the web app's own session may: a
 * token minting tokens would let any scoped credential outlive itself
 * (the escalation the auth endpoints already refuse). A token never gets a
 * scope the caller cannot use now.
 */
export async function createAccessToken(
	db: UserDb,
	principal: Principal,
	input: { name: string; scopes: Scope[]; expiresInDays: number },
): Promise<{ token: AccessTokenDto; key: string }> {
	assertWebSession(principal, "Access tokens are created from the web app");
	const scopes = [...new Set(input.scopes)];
	const missing = scopes.filter((s) => !principal.scopes.includes(s));
	if (missing.length > 0) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `You cannot grant ${missing.join(", ")}`,
		});
	}
	const created = await auth.api.createApiKey({
		body: {
			userId: principal.userId,
			name: input.name,
			expiresIn: input.expiresInDays * DAY_SECONDS,
			permissions: { scopes },
		},
	});
	const row = await db.apikey.findFirstOrThrow({
		where: { id: created.id, referenceId: principal.userId },
	});
	return { token: toAccessToken(row), key: created.key };
}

/** Revokes one of the caller's tokens (the one in use too); NOT_FOUND otherwise. */
export async function revokeAccessToken(caller: Caller, id: string) {
	const { count } = await caller.db.apikey.deleteMany({
		where: { id, referenceId: caller.principal.userId },
	});
	if (count === 0) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
	}
	return { ok: true as const };
}

const createdCursor = z.object({ createdAt: z.iso.datetime(), id: z.string() });

/** GET /tokens: a page of the caller's tokens as contract DTOs. */
export async function listAccessTokenPage(caller: Caller, q: CursorQuery) {
	assertWebSession(
		caller.principal,
		"Access tokens are listed from the web app",
	);
	const after = decodeCursor(q.cursor, createdCursor);
	const rows = await listAccessTokens(caller.db, caller.principal.userId, {
		after: after
			? { createdAt: new Date(after.createdAt), id: after.id }
			: null,
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }),
		toAccessToken,
	);
}

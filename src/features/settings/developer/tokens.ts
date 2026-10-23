import {
	parseScopeList,
	SCOPES,
	type Scope,
} from "@retrospend/api-contract/common";
import { authClient } from "~/lib/auth-client";
import type { RouterOutputs } from "~/trpc/react";

/**
 * The Developer section's one seam to the server (IMPLEMENTATION §2.3).
 *
 * Personal access tokens are better-auth api-key rows (rsk_ prefix, hashed,
 * always expiring). Their scopes live in `permissions` and the plugin only
 * lets the server set them, so until POST /api/v1/tokens (S3 platform)
 * exists a key made here gets the plugin default, `read`. createToken takes
 * the scopes already, so the route swaps in here and nothing else changes.
 * docs/ui/GAPS.md, "Developer: token scopes".
 */

/** Scopes this server can put on a new key today. */
export const CREATABLE_SCOPES: readonly Scope[] = ["read"];

/** Expiry choices in days; the plugin allows 1 to 365, and keys always expire. */
export const EXPIRY_DAYS = [30, 90, 365] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];
export const DEFAULT_EXPIRY: ExpiryDays = 90;

export type ApiToken = {
	id: string;
	name: string;
	/** The first characters (rsk_…), to tell keys apart. */
	start: string | null;
	scopes: Scope[];
	createdAt: Date;
	expiresAt: Date | null;
	lastUsedAt: Date | null;
};

type KeyRow = {
	id: string;
	name?: string | null;
	start?: string | null;
	permissions?: Record<string, string[]> | null;
	createdAt: Date | string;
	expiresAt?: Date | string | null;
	lastRequest?: Date | string | null;
};

const asDate = (v: Date | string | null | undefined) =>
	v ? new Date(v) : null;

/** A plugin row as the section shows it; unknown scopes are dropped. */
export function toToken(row: KeyRow): ApiToken {
	return {
		id: row.id,
		name: row.name ?? "",
		start: row.start ?? null,
		scopes: parseScopeList((row.permissions?.scopes ?? []).join(" ")).scopes,
		createdAt: new Date(row.createdAt),
		expiresAt: asDate(row.expiresAt),
		lastUsedAt: asDate(row.lastRequest),
	};
}

/** Scopes in the contract's order, so every list reads the same. */
export function orderScopes(scopes: readonly Scope[]): Scope[] {
	return SCOPES.filter((s) => scopes.includes(s));
}

/** The message key for a scope under device.scopes (shared with /device). */
export function scopeKey(scope: Scope): string {
	return scope.replace(/:(\w)/, (_, c: string) => c.toUpperCase());
}

export async function listTokens(): Promise<ApiToken[]> {
	const { data, error } = await authClient.apiKey.list();
	if (error) throw new Error(error.message);
	const rows = (data as { apiKeys?: KeyRow[] } | KeyRow[] | null) ?? [];
	const list = Array.isArray(rows) ? rows : (rows.apiKeys ?? []);
	return list
		.map(toToken)
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type CreateTokenInput = {
	name: string;
	expiresInDays: ExpiryDays;
	scopes: readonly Scope[];
};

/** Makes a key and returns its secret, which is shown once and never again. */
export async function createToken(
	input: CreateTokenInput,
): Promise<{ key: string; token: ApiToken }> {
	const unavailable = input.scopes.filter((s) => !CREATABLE_SCOPES.includes(s));
	if (unavailable.length > 0)
		throw new Error(unavailable.join(" "));
	const { data, error } = await authClient.apiKey.create({
		name: input.name,
		expiresIn: input.expiresInDays * 24 * 60 * 60,
	});
	if (error || !data) throw new Error(error?.message);
	return { key: data.key, token: toToken(data as KeyRow) };
}

export async function revokeToken(id: string): Promise<void> {
	const { error } = await authClient.apiKey.delete({ keyId: id });
	if (error) throw new Error(error.message);
}

/** Whether a key has passed its expiry (the plugin refuses it from then on). */
export function isExpired(token: ApiToken, now: Date = new Date()): boolean {
	return token.expiresAt != null && token.expiresAt.getTime() <= now.getTime();
}

/** An approved device as deviceSession.list returns it (no token, ever). */
export type ApprovedDevice = RouterOutputs["deviceSession"]["list"][number];

import type { AccessTokenDto } from "@retrospend/api-contract";
import {
	SCOPES,
	type Scope,
	TOKEN_DEFAULT_DAYS,
} from "@retrospend/api-contract";
import type { RouterOutputs } from "~/trpc/react";

/**
 * The Developer section's token model (IMPLEMENTATION §2.3). Tokens come
 * from GET /api/v1/tokens and are made and revoked through the same route
 * family, called with the web session (the routes refuse any other
 * credential). The key itself is in the create response only.
 */

/** Expiry choices in days; the route allows 1 to 365, and keys always expire. */
export const EXPIRY_DAYS = [30, 90, 365] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];
export const DEFAULT_EXPIRY: ExpiryDays = TOKEN_DEFAULT_DAYS as ExpiryDays;

/** A new key starts with read access only. */
export const DEFAULT_SCOPES: readonly Scope[] = ["read"];

export type ApiToken = {
	id: string;
	name: string;
	/** The first characters (rsk_…), to tell keys apart. */
	start: string | null;
	scopes: Scope[];
	enabled: boolean;
	createdAt: Date;
	expiresAt: Date | null;
	lastUsedAt: Date | null;
};

const asDate = (v: string | null) => (v ? new Date(v) : null);

export function toToken(dto: AccessTokenDto): ApiToken {
	return {
		id: dto.id,
		name: dto.name,
		start: dto.start,
		scopes: dto.scopes,
		enabled: dto.enabled,
		createdAt: new Date(dto.createdAt),
		expiresAt: asDate(dto.expiresAt),
		lastUsedAt: asDate(dto.lastUsedAt),
	};
}

/** Scopes in the contract's order, so every list reads the same. */
export function orderScopes(scopes: readonly Scope[]): Scope[] {
	return SCOPES.filter((s) => scopes.includes(s));
}

/** The scopes a person can put on a key: everything they hold, so admin only for admins. */
export function grantableScopes(isAdmin: boolean): Scope[] {
	return SCOPES.filter((s) => s !== "admin" || isAdmin);
}

/** The message key for a scope under device.scopes (shared with /device). */
export function scopeKey(scope: Scope): string {
	return scope.replace(/:(\w)/, (_, c: string) => c.toUpperCase());
}

/** When a key made now with this lifetime stops working. */
export function expiryFrom(days: number, now: Date = new Date()): Date {
	return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Whether a key has passed its expiry (the server refuses it from then on). */
export function isExpired(token: ApiToken, now: Date = new Date()): boolean {
	return token.expiresAt != null && token.expiresAt.getTime() <= now.getTime();
}

/** An approved device as deviceSession.list returns it (no token, ever). */
export type ApprovedDevice = RouterOutputs["deviceSession"]["list"][number];

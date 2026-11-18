import { implement, os } from "@orpc/server";
import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";
import { contract } from "@retrospend/api-contract";
import {
	type ApiMeta,
	isWriteMethod,
	publicWriteProblem,
} from "@retrospend/api-contract/common";
import { V1_ALLOWED } from "~/server/api/protection/allowed";
import { isAllowed } from "~/server/api/protection/guard";
import type { db as globalDb } from "~/server/db";
import {
	type Principal,
	resolvePrincipal,
} from "~/server/services/api-v1/principal.service";
import { scopedDbFor } from "~/server/services/api-v1/scoped-db";
import { ensureUserKeyringWhenSealing } from "~/server/services/keys/data-key.service";
import { userTimeZone } from "~/server/services/user-time-zone";
import { requestTimeZone } from "~/server/time-zone";
import { appOriginFrom, isCrossSiteWrite } from "./csrf";
import { problem } from "./errors";
import { recordsEvent } from "./events/middleware";
import { idempotency } from "./idempotency";
import { ipRateLimit, tokenRateLimit } from "./rate-limit";
import { mayCall } from "./scopes";

/** What the route handler passes in for each request. */
export type V1InitialContext = ResponseHeadersPluginContext & {
	headers: Headers;
};

/**
 * The signed-in caller, with the same user-scoped Prisma client tRPC's
 * protectedProcedure builds, so RLS applies identically on both transports.
 */
export type V1User = {
	principal: Principal;
	db: typeof globalDb;
	/** The caller's IANA zone for day and month bucketing (resolveTimeZone). */
	timeZone: string;
};

export type V1Context = V1InitialContext & { user: V1User | null };

/** `METHOD /path` as the allowlist and the contract name a route. */
function routeKey(route: { method?: string; path?: string }): string {
	return `${(route.method ?? "POST").toUpperCase()} ${route.path}`;
}

/**
 * Resolves the principal and enforces, in order: credentials (401), the
 * route's scope (403 missing_scope) and advanced protection (403
 * protected_account). A public GET (server-info) skips both but still sees
 * the caller when valid credentials are sent. A public POST never sees one
 * (see ignoresSession below).
 */
const authenticate = os
	.$context<V1InitialContext>()
	.$meta<ApiMeta>({})
	.middleware(async ({ context, next, procedure }) => {
		const { meta, route } = procedure["~orpc"];
		const scope = meta.scope;
		if (!scope) throw problem("internal", "Route has no scope");
		const method = (route.method ?? "POST").toUpperCase();
		// Fail closed: a publicWrite meta the contract would refuse (an unknown
		// value, a signed-in scope, a GET) is never run, whatever the route does.
		const badPublicWrite = publicWriteProblem(meta, method, route.path);
		if (badPublicWrite) throw problem("internal", badPublicWrite);
		const resolved = await resolvePrincipal(context.headers);
		const principal = resolved.ok ? resolved.principal : null;

		// A cookie session is attached by the browser to any site's request, so
		// a write from another site is refused (csrf.ts). Tokens are not.
		if (
			principal?.kind === "web" &&
			isWriteMethod(method) &&
			isCrossSiteWrite(
				context.headers,
				appOriginFrom(
					process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL,
				),
			)
		)
			throw problem("forbidden", "This request came from another site");

		if (scope !== "public") {
			if (!principal) throw problem("unauthenticated");
			if (!mayCall(principal, scope))
				throw problem("missing_scope", `This route needs the ${scope} scope`, {
					requiredScope: scope,
				});
		}

		// Advanced protection, deny by default. After the scope check so a
		// missing scope still says so, before the keyring, the zone and the
		// idempotency record: a refusal writes nothing. Public routes have no
		// personal data to protect.
		if (
			principal?.protected &&
			scope !== "public" &&
			!isAllowed(V1_ALLOWED, routeKey(route))
		)
			throw problem("protected_account");

		// A public write (a POST, in practice) acts the same with or without a
		// session: no keyring is made, no zone is claimed, and idempotency, events
		// and the token limit see no user. That holds for every public write, not
		// only readsOnly and publicWrite ones, so a route that skips its meta still
		// never writes, records or keeps an Idempotency-Key as a cookie's user. A
		// public GET (server-info) reflects the caller, as its description says.
		const ignoresSession = scope === "public" && isWriteMethod(method);
		let user: V1User | null = null;
		if (principal && !ignoresSession) {
			// When sealing, the user's key exists before any transaction needs it.
			await ensureUserKeyringWhenSealing(principal.userId);
			const db = scopedDbFor(principal.userId);
			const zone = requestTimeZone(context.headers);
			user = {
				principal,
				db,
				timeZone: await userTimeZone(db, principal.userId, zone),
			};
		}
		return next({ context: { user } });
	});

/**
 * The whole v1 chain as one middleware. Order matters: the IP limit runs
 * before any credential check, idempotency last so a replay never runs
 * the handler. Tests apply it to their own contracts.
 */
export const v1Middleware = ipRateLimit
	.concat(authenticate)
	.concat(tokenRateLimit)
	.concat(idempotency)
	.concat(recordsEvent);

/**
 * The implementer every v1 group builds on:
 * `v1.<group>.<route>.handler(({ context }) => ...)`.
 */
export const v1 = implement(contract)
	.$context<V1InitialContext>()
	.use(v1Middleware);

/** The signed-in caller on a non-public route (authenticate guarantees it). */
export function signedIn(context: V1Context): V1User {
	if (!context.user) throw problem("unauthenticated");
	return context.user;
}

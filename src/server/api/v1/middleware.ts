import { implement, os } from "@orpc/server";
import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";
import { contract } from "@retrospend/api-contract";
import type { ApiMeta } from "@retrospend/api-contract/common";
import type { db as globalDb } from "~/server/db";
import { isFlagEnabled } from "~/server/flags";
import {
	type Principal,
	resolvePrincipal,
} from "~/server/services/api-v1/principal.service";
import { scopedDbFor } from "~/server/services/api-v1/scoped-db";
import { userTimeZone } from "~/server/services/user-time-zone";
import { requestTimeZone } from "~/server/time-zone";
import { problem } from "./errors";
import { recordsEvent } from "./events/middleware";
import { idempotency } from "./idempotency";
import { ipRateLimit, tokenRateLimit } from "./rate-limit";
import { hasScope } from "./scopes";

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

/**
 * Resolves the principal and enforces, in order: credentials (401), the
 * apiV1Mode flag (403 api_disabled) and the route's scope (403
 * missing_scope). Public routes (server-info) skip all three but still see
 * the caller when valid credentials are sent.
 */
const authenticate = os
	.$context<V1InitialContext>()
	.$meta<ApiMeta>({})
	.middleware(async ({ context, next, procedure }) => {
		const scope = procedure["~orpc"].meta.scope;
		if (!scope) throw problem("internal", "Route has no scope");
		const resolved = await resolvePrincipal(context.headers);
		const principal = resolved.ok ? resolved.principal : null;

		if (scope !== "public") {
			if (!principal) throw problem("unauthenticated");
			if (!(await isFlagEnabled("apiV1", { role: principal.role })))
				throw problem("api_disabled");
			if (!hasScope(principal.scopes, scope))
				throw problem("missing_scope", `This route needs the ${scope} scope`, {
					requiredScope: scope,
				});
		}

		let user: V1User | null = null;
		if (principal) {
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

import {
	type AnyContractProcedure,
	type AnyContractRouter,
	isContractProcedure,
	oc,
} from "@orpc/contract";
import { PREVIEW_SUFFIX } from "./preview";
import type { RouteScope } from "./scopes";

/** What proves a public write; the one list the checks below read. */
export const PUBLIC_WRITES = ["resetToken", "resetRequest"] as const;
export type PublicWrite = (typeof PUBLIC_WRITES)[number];

/**
 * Why a route's `publicWrite` meta is not allowed, or null when it is absent
 * or allowed. The contract conventions and the server's authenticate step both
 * ask this, so the rule lives here once. A value off the list, a method other
 * than POST, a scope other than public, a readsOnly, an event or a preview
 * twin are all refused; the server answers such a route with an internal
 * error instead of running it.
 */
export function publicWriteProblem(
	meta: ApiMeta,
	method: string,
	path: string | undefined,
): string | null {
	if (meta.publicWrite === undefined) return null;
	if (!(PUBLIC_WRITES as readonly unknown[]).includes(meta.publicWrite))
		return `unknown publicWrite "${String(meta.publicWrite)}"`;
	if (method.toUpperCase() !== "POST") return "publicWrite is for a POST";
	if (meta.scope !== "public") return "publicWrite is for a public route";
	if (meta.readsOnly) return "a publicWrite route cannot be readsOnly";
	if (meta.event) return "a publicWrite route cannot have an event";
	if (meta.previewOf || path?.endsWith(PREVIEW_SUFFIX))
		return "a publicWrite route cannot be a preview twin";
	return null;
}

/**
 * Per-route metadata the server middleware and the contract tests read.
 * - `scope`: what the caller needs. Required on every route; the contract
 *   test fails on a route without one.
 * - `event`: the event type a write appends to the outbox.
 * - `previewOf`: on a preview twin, the path of the write it previews.
 *   Every write scoped `write:money` must have one at `<path>/preview`.
 * - `secretResponse`: the response holds a secret shown once, so the
 *   idempotency store keeps no copy of it.
 * - `readsOnly`: a POST that writes nothing (the body carries what a query
 *   string should not, such as an email address). It needs no event and no
 *   Idempotency-Key, may be public, and ignores any session sent with it. On
 *   a signed-in scope it still reads the session but needs no Idempotency-Key
 *   (the first step of a password change: it spends a try, stores nothing).
 * - `publicWrite`: a public POST that writes and is proved by a secret in its
 *   own body instead of a session: `resetToken` (a single-use reset token) or
 *   `resetRequest` (a request with no token yet, answered alike for every
 *   address). It has no event and needs no Idempotency-Key (the token is
 *   single use), and the server drops any session sent with it, so nothing is
 *   written, recorded or kept as the cookie's user. Only a public POST may
 *   carry it (publicWriteProblem); any other public write is refused.
 * - `snapshot`: on a `sync` route, the body is a whole table as of one read,
 *   not a cursor delta, so the route never answers 410 sync_reset_required.
 */
export interface ApiMeta {
	scope?: RouteScope;
	event?: string;
	previewOf?: string;
	secretResponse?: boolean;
	readsOnly?: boolean;
	publicWrite?: PublicWrite;
	snapshot?: boolean;
}

/** Every v1 route starts here. Paths are relative to `/api/v1`. */
export const v1 = oc.$meta<ApiMeta>({});

export const API_PREFIX = "/api/v1";

export type ContractEntry = {
	/** Router keys, for example ["platform", "me"]. */
	key: string[];
	procedure: AnyContractProcedure;
	meta: ApiMeta;
	method: string;
	path: string | undefined;
};

/** Every procedure in a contract router, depth first in key order. */
export function listContractRoutes(
	router: AnyContractRouter,
	key: string[] = [],
): ContractEntry[] {
	if (isContractProcedure(router)) {
		const def = router["~orpc"];
		return [
			{
				key,
				procedure: router,
				meta: def.meta as ApiMeta,
				method: (def.route.method ?? "POST").toUpperCase(),
				path: def.route.path,
			},
		];
	}
	return Object.keys(router)
		.sort()
		.flatMap((name) =>
			listContractRoutes(
				(router as Record<string, AnyContractRouter>)[
					name
				] as AnyContractRouter,
				[...key, name],
			),
		);
}

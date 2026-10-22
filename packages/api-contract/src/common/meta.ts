import {
	type AnyContractProcedure,
	type AnyContractRouter,
	isContractProcedure,
	oc,
} from "@orpc/contract";
import type { RouteScope } from "./scopes";

/**
 * Per-route metadata the server middleware and the contract tests read.
 * - `scope`: what the caller needs. Required on every route; the contract
 *   test fails on a route without one.
 * - `event`: the event type a write appends to the outbox.
 * - `money`: a money write; it must have a preview twin at `<path>/preview`.
 * - `previewOf`: on the twin, the path of the write it previews.
 * - `secretResponse`: the response holds a secret shown once, so the
 *   idempotency store keeps no copy of it.
 */
export interface ApiMeta {
	scope?: RouteScope;
	event?: string;
	money?: boolean;
	previewOf?: string;
	secretResponse?: boolean;
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

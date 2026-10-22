import type { AnyContractRouter } from "@orpc/contract";
import { EVENT_TYPES } from "./events";
import { listContractRoutes } from "./meta";
import { PREVIEW_SUFFIX, previewPathOf, previewResultSchema } from "./preview";
import { SCOPES } from "./scopes";

const ROUTE_SCOPES: readonly string[] = [...SCOPES, "public"];

/**
 * Checks the v1 rules a contract must follow and returns one message per
 * violation (empty when it passes). Runs in the contract test against the
 * real contract, so a group that adds a route without a scope, a write
 * scoped read or public, a write without an event or a write:money write
 * without its preview twin fails CI.
 */
export function checkContractConventions(
	router: AnyContractRouter,
	eventTypes: readonly string[] = EVENT_TYPES,
): string[] {
	const routes = listContractRoutes(router);
	const problems: string[] = [];
	const seen = new Map<string, string>();
	const operationIds = new Set<string>();

	for (const r of routes) {
		const name = r.key.join(".");
		const def = r.procedure["~orpc"];
		const scope = r.meta.scope;
		if (!scope) problems.push(`${name}: no scope`);
		else if (!ROUTE_SCOPES.includes(scope))
			problems.push(`${name}: unknown scope "${scope}"`);
		if (r.method !== "GET" && (scope === "public" || scope === "read"))
			problems.push(`${name}: a write needs a write scope, not ${scope}`);

		if (!r.path?.startsWith("/")) problems.push(`${name}: no path`);
		const route = `${r.method} ${r.path}`;
		const clash = seen.get(route);
		if (clash) problems.push(`${name}: ${route} is also ${clash}`);
		seen.set(route, name);

		const opId = def.route.operationId;
		if (!opId) problems.push(`${name}: no operationId`);
		else if (operationIds.has(opId))
			problems.push(`${name}: duplicate operationId ${opId}`);
		if (opId) operationIds.add(opId);

		if (!def.outputSchema) problems.push(`${name}: no output schema`);

		const isPreview = r.path?.endsWith(PREVIEW_SUFFIX) ?? false;
		if (r.method !== "GET" && !isPreview) {
			if (!r.meta.event) problems.push(`${name}: write without an event`);
			else if (!eventTypes.includes(r.meta.event))
				problems.push(`${name}: event "${r.meta.event}" is not registered`);
		}
		if (isPreview !== Boolean(r.meta.previewOf))
			problems.push(`${name}: preview routes and previewOf must go together`);
		if (isPreview && def.outputSchema !== previewResultSchema)
			problems.push(`${name}: a preview twin must return PreviewResult`);
	}

	// A money write is any write scoped write:money, so a route cannot skip
	// its preview twin by leaving a flag off.
	const moneyWrites = routes.filter(
		(x) =>
			x.meta.scope === "write:money" &&
			x.method !== "GET" &&
			!(x.path?.endsWith(PREVIEW_SUFFIX) ?? false),
	);
	for (const r of moneyWrites) {
		const name = r.key.join(".");
		const twin = routes.find(
			(x) =>
				x.meta.previewOf === r.path &&
				x.path === previewPathOf(r.path ?? "") &&
				x.method === "POST",
		);
		if (!twin) problems.push(`${name}: money write without a preview twin`);
		else if (
			twin.procedure["~orpc"].inputSchema !== r.procedure["~orpc"].inputSchema
		)
			problems.push(`${name}: preview twin takes a different input`);
	}
	return problems;
}

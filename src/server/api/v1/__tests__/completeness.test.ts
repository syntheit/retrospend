/**
 * The completeness gate (S3 milestone 6): every tRPC procedure either has the
 * v1 routes that do its job or a written reason it has none. Zero
 * unexplained rows. Reasons live in scripts/api-v1-completeness.map.ts.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "~/server/api/root";
import { TRPC_ALLOWED, V1_ALLOWED } from "~/server/api/protection/allowed";
import {
	buildReport,
	formatReport,
	isClean,
	listProcedures,
	listRouteKeys,
} from "../../../../../scripts/api-v1-completeness";
import { COMPLETENESS } from "../../../../../scripts/api-v1-completeness.map";

const report = buildReport();

describe("API v1 completeness", () => {
	it("explains every tRPC procedure", () => {
		expect(report.unexplained).toEqual([]);
	});

	it("keeps no entry for a procedure that is gone", () => {
		expect(report.stale).toEqual([]);
	});

	it("names only routes the contract has", () => {
		expect(report.missingRoutes).toEqual([]);
	});

	it("gives every reason words", () => {
		expect(report.blankReasons).toEqual([]);
	});

	it("is clean as a whole, with a report that lists every procedure", () => {
		expect(isClean(report)).toBe(true);
		expect(report.rows.length).toBeGreaterThan(400);
		expect(formatReport(report)).toContain("procedures:");
	});

	it("writes no em dash in a reason", () => {
		for (const [key, entry] of Object.entries(COMPLETENESS))
			if ("why" in entry) expect(entry.why, key).not.toContain("\u2014");
	});

	it("keeps the platform rows to the ones the platform agent builds", () => {
		const platform = report.rows
			.filter((r) => r.kind === "g5-platform")
			.map((r) => r.procedure);
		expect(platform).toEqual([
			"deviceSession.disconnect",
			"deviceSession.list",
		]);
	});
});

/**
 * The advanced-protection allowlist (src/server/api/protection/allowed.ts):
 * every entry is a real route with a reason, today's public procedures are
 * pinned, and nothing that touches the personal ledger can slip in.
 */
describe("protection allowlist", () => {
	const procedures = listProcedures().map((p) => p.procedure);
	const routes = listRouteKeys();

	it("names only procedures and routes that exist", () => {
		expect(
			Object.keys(TRPC_ALLOWED).filter((k) => !procedures.includes(k)),
		).toEqual([]);
		expect(Object.keys(V1_ALLOWED).filter((k) => !routes.has(k))).toEqual([]);
	});

	it("gives every entry a reason in words, with no em dash", () => {
		for (const list of [TRPC_ALLOWED, V1_ALLOWED])
			for (const [key, reason] of Object.entries(list)) {
				expect(reason.trim().length, key).toBeGreaterThan(8);
				expect(reason, key).not.toContain("\u2014");
			}
	});

	it("pins the public procedures, so a new one is reviewed, and allows each", () => {
		const registry = (
			appRouter as unknown as {
				_def: {
					procedures: Record<string, { _def: { meta?: { public?: boolean } } }>;
				};
			}
		)._def.procedures;
		const isPublic = Object.keys(registry)
			.filter((path) => registry[path]?._def.meta?.public === true)
			.sort();
		expect(isPublic).toEqual([
			"auth.confirmEmailChange",
			"auth.getAppFeatures",
			"auth.requestPasswordReset",
			"auth.resetPassword",
			"auth.revertEmailChange",
			"auth.verifyEmail",
			"claim.info",
			"claim.linkGuestToGhost",
			"claim.projectGhosts",
			"exchangeRate.getRate",
			"guest.register",
			"guest.resume",
			"guest.validateLink",
			"invite.validate",
			"notification.unsubscribe",
			"notification.unsubscribeAll",
			"profile.publicProfile",
			"project.publicPageView",
			"settings.getInviteOnlyEnabled",
			"system.getFeatureFlags",
		]);
		expect(isPublic.filter((p) => !(p in TRPC_ALLOWED))).toEqual([]);
	});

	it("never allows the personal ledger or the settings that moved to the sealed record", () => {
		const ledgerPaths =
			/^\/(sync|budget|expenses|figures|accounts|imports|exports|activity|income|transfers|recurring|categories|people|projects|shared-expenses|payments|insights|search|wealth)(\/|$)/;
		const v1Blocked = [
			"GET /settings",
			"PATCH /settings",
			"GET /settings/pages/{page}",
			"PATCH /settings/pages/{page}",
		];
		const v1Wrong = Object.keys(V1_ALLOWED).filter((key) => {
			const path = key.slice(key.indexOf(" ") + 1);
			return (
				ledgerPaths.test(path) ||
				v1Blocked.includes(key) ||
				/^\/settings\/(category-preferences|favorite-rates)/.test(path) ||
				path === "/profile/stats" ||
				/^\/rates\/(table|\{currency\}\/(convert|series))$/.test(path) ||
				path === "/currencies/{currency}/spending"
			);
		});
		expect(v1Wrong).toEqual([]);

		const ledgerRouters =
			/^(expense|entry|envelope|wealth|recurring|categories|importQueue|exportData|insights|home|corrections|people|project|settlement|sharedTransaction|verification|billingPeriod|paymentMethod|auditLog|preferences)\./;
		const trpcWrong = Object.keys(TRPC_ALLOWED).filter(
			(key) =>
				(ledgerRouters.test(key) && key !== "project.publicPageView") ||
				[
					"settings.getGeneral",
					"settings.updateGeneral",
					"profile.getLifetimeStats",
					"exchangeRate.spending",
					"exchangeRate.history",
				].includes(key),
		);
		expect(trpcWrong).toEqual([]);
	});
});

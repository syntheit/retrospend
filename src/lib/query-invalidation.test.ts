import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
	CROSS_ROUTER_INVALIDATIONS,
	handleMutationSuccess,
} from "./query-invalidation";

function invalidatedRouters(path: string[]): string[] {
	const invalidateQueries = vi.fn();
	handleMutationSuccess({ invalidateQueries } as unknown as QueryClient, {
		options: { mutationKey: [path] },
	});
	return invalidateQueries.mock.calls.map(
		(call) => (call[0] as { queryKey: string[][] }).queryKey[0]![0]!,
	);
}

describe("handleMutationSuccess", () => {
	it.each(["create", "settleAll", "confirm", "reject", "deletePending", "void"])(
		"settlement.%s refreshes project and people views",
		(procedure) => {
			const routers = invalidatedRouters(["settlement", procedure]);
			expect(routers).toEqual(
				expect.arrayContaining(["settlement", "project", "people", "billingPeriod"]),
			);
		},
	);
});

/**
 * Mutation -> routers whose queries must refresh after it succeeds.
 * Each entry exists because a screen reads data the mutation changes.
 * Removing a reader here should be a deliberate decision.
 */
const REQUIRED_READERS: Record<string, string[]> = {
	// The dashboard overview shows budget totals.
	"budget.upsertBudget": ["budget", "dashboard"],
	"budget.batchUpsertBudgets": ["budget", "dashboard"],
	"budget.deleteBudget": ["budget", "dashboard"],
	"budget.copyFromLastMonth": ["budget", "dashboard"],

	// Category edits change names, colors and exclusions shown everywhere.
	"categories.update": ["categories", "budget", "dashboard", "expense"],
	"categories.delete": ["categories", "budget", "dashboard", "expense"],
	"expense.bulkUpdateCategory": ["expense", "budget", "dashboard", "stats"],

	// The fiscal month start day moves every month boundary.
	"settings.updateGeneral": ["settings", "dashboard", "budget", "stats", "expense"],

	// Personal expenses feed the overview, budgets and stats.
	"expense.createExpense": ["expense", "dashboard", "budget", "stats"],
	"expense.updateExpense": ["expense", "dashboard", "budget", "stats"],
	"expense.deleteExpense": ["expense", "dashboard", "budget", "stats"],

	// Shared expenses also move balances.
	"sharedTransaction.create": ["project", "people", "dashboard", "budget", "stats"],
	"sharedTransaction.update": ["project", "people", "dashboard", "budget", "stats"],
	"sharedTransaction.delete": ["project", "people", "dashboard", "budget", "stats"],
};

describe("cross-router invalidation map", () => {
	it.each(Object.entries(REQUIRED_READERS))(
		"%s refreshes its readers",
		(mutation, readers) => {
			const routers = invalidatedRouters(mutation.split("."));
			expect(routers).toEqual(expect.arrayContaining(readers));
		},
	);

	it("only names routers that exist", () => {
		const root = readFileSync(
			join(__dirname, "../server/api/root.ts"),
			"utf8",
		);
		const body = root.slice(root.indexOf("createTRPCRouter({"));
		const routers = new Set(
			[...body.matchAll(/^\t(\w+): \w+Router,$/gm)].map((m) => m[1]),
		);
		expect(routers.size).toBeGreaterThan(10);

		for (const [mutation, deps] of Object.entries(CROSS_ROUTER_INVALIDATIONS)) {
			expect(routers, mutation).toContain(mutation.split(".")[0]);
			for (const dep of deps) {
				expect(routers, `${mutation} -> ${dep}`).toContain(dep);
			}
		}
	});

	it("only names procedures that exist", () => {
		const dir = join(__dirname, "../server/api/routers");
		const source = readdirSync(dir)
			.filter((f) => f.endsWith(".ts"))
			.map((f) => readFileSync(join(dir, f), "utf8"))
			.join("\n");

		for (const mutation of Object.keys(CROSS_ROUTER_INVALIDATIONS)) {
			const procedure = mutation.split(".")[1]!;
			expect(source, mutation).toMatch(
				new RegExp(`^\\t${procedure}: \\w*[Pp]rocedure`, "m"),
			);
		}
	});
});

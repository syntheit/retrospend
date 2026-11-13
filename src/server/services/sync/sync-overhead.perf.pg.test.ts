/**
 * What the stamp trigger adds to a 10,000-row import commit (E2EE lane P,
 * P14a, plan test 12). The same createMany runs with the expense insert
 * trigger on and off, alternating, and the medians are compared. It runs
 * alone, after the other pg files (vitest.pg.config.ts), so other workers
 * cannot skew it. The budget is never loosened.
 */
import { describe, expect, it } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { stampsOf } from "./sync-test-support";

const ROWS = 10_000;
const ROUNDS = 3;
/**
 * Extra milliseconds a 10,000-row statement may take for its stamps. Measured
 * at 115 ms (1,630 against 1,515 ms) on 2026-11-13; the budget is about nine
 * times that.
 */
const OVERHEAD_BUDGET_MS = 1_000;

const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function commitOnce(userId: string): Promise<number> {
	const started = performance.now();
	await fixtureDb.expense.createMany({
		data: Array.from({ length: ROWS }, (_, i) => ({
			userId,
			title: `Import ${i}`,
			amount: String(10 + (i % 50)),
			currency: "ARS",
			date: new Date("2026-10-05T00:00:00.000Z"),
			amountInUSD: "0.01",
			exchangeRate: "1468",
			pricingSource: "IMPORT",
		})),
	});
	return performance.now() - started;
}

describe("write overhead of the stamp trigger", () => {
	it("a 10,000-row import commit costs the stamps only a bounded extra", async () => {
		const stamped: number[] = [];
		const bare: number[] = [];
		const { user } = await createTestUser();
		try {
			for (let round = 0; round < ROUNDS; round++) {
				stamped.push(await commitOnce(user.id));
				expect(await stampsOf(user.id, "expense")).toHaveLength(
					ROWS * (round + 1),
				);
				await adminDb.$executeRawUnsafe(
					`ALTER TABLE "expense" DISABLE TRIGGER "sync_expense_ins"`,
				);
				try {
					bare.push(await commitOnce(user.id));
				} finally {
					await adminDb.$executeRawUnsafe(
						`ALTER TABLE "expense" ENABLE TRIGGER "sync_expense_ins"`,
					);
				}
			}
		} finally {
			await adminDb.user.delete({ where: { id: user.id } });
		}
		const extra = median(stamped) - median(bare);
		expect(
			extra,
			`with stamps ${median(stamped).toFixed(0)} ms, without ${median(bare).toFixed(0)} ms`,
		).toBeLessThan(OVERHEAD_BUDGET_MS);
	}, 300_000);
});

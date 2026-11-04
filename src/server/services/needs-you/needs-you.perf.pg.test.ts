/**
 * The needsYou timing budget on a real Postgres. It runs alone, after the
 * other pg files (vitest.pg.config.ts), so other workers cannot skew it. The
 * budget is never loosened. A user with three of each source, over the
 * Flex book from test-fixtures.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { needsYou } from "./index";
import { opts, seedBusyUser } from "./test-fixtures";

describe("needsYou query budget", () => {
	let busy: Awaited<ReturnType<typeof seedBusyUser>>;

	beforeAll(async () => {
		busy = await seedBusyUser();
	});

	it("p95 under 150 ms", async () => {
		await needsYou(adminDb, busy.user.id, opts);
		const runs: number[] = [];
		for (let i = 0; i < 20; i++) {
			const t = performance.now();
			await needsYou(adminDb, busy.user.id, opts);
			runs.push(performance.now() - t);
		}
		runs.sort((a, b) => a - b);
		expect(runs[18]).toBeLessThan(150);
	});
});

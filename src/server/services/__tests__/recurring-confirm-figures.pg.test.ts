/**
 * The recurring confirm preview names the figures an expense moves, as
 * expense.create does: spent and glance.spent. Base case (see
 * recurring-write-characterization.pg.test.ts): home ARS, blue 1,545 from
 * Nov 30, a monthly USD 20 template due 2026-12-01T03:00Z, read at
 * 2026-12-01T12:00Z in Buenos Aires.
 *   spent (by entry currency):  USD 20.00            = 2,000 minor
 *   glance.spent (home):        20 x 1,545 = 30,900.00 ARS = 3,090,000 minor
 * Both start at 0 and the preview changes nothing.
 */
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectBody } from "~/server/api/v1/core/__tests__/harness";
import { fixtureDb } from "~/test/pg-harness";
import { arsUser, setRates, usdTemplate, v1For } from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const NOW = "2026-12-01T12:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";

beforeAll(async () => {
	await setRates([
		["2026-11-30", "ARS", "blue", "1545"],
		["2026-12-01", "ARS", "official", "1050"],
	]);
});
afterEach(() => vi.useRealTimers());

describe("recurring confirm preview figures", () => {
	it("reports spent in USD and glance.spent in the home currency", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { autoPay: false });
		const v1 = await v1For(me);
		vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
		const preview = await expectBody<{
			changes: {
				id: string;
				before: { minor: number; currency: string } | null;
				delta: { minor: number; currency: string };
			}[];
			unavailable: { id: string }[];
		}>(
			await v1("POST", `/recurring/${id}/confirm/preview`, { dueAt: DUE }),
			contract.recurring.previewConfirm,
		);
		expect(preview.changes.map((c) => [c.id, c.delta])).toEqual([
			["spent", { minor: 2_000, currency: "USD" }],
			["glance.spent", { minor: 3_090_000, currency: "ARS" }],
		]);
		expect(
			preview.changes.find((c) => c.id === "glance.spent")?.before,
		).toEqual({ minor: 0, currency: "ARS" });
		expect(preview.unavailable).toEqual([]);
		await expect(
			fixtureDb.expense.count({ where: { userId: me } }),
		).resolves.toBe(0);
	});
});

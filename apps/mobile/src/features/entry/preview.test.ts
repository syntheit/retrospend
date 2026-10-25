import type { RetrospendClient } from "@retrospend/api-client";
import type { PendingWrite } from "./draft";
import { changeLines, fetchPreview, type PreviewDto } from "./preview";

const line = (minor: number, currency = "ARS") => ({ minor, currency });

// Income of ARS 2,950,000 with Use my plan: it lands in To assign, then the
// plan moves ARS 2,500,000 into envelopes. Net worth stays; nothing is spent.
const incomeDiff: PreviewDto = {
	changes: [
		{
			id: "budget.notPlannedYet",
			currency: "ARS",
			before: line(0),
			after: line(45_000_000),
			delta: line(45_000_000),
			figureAfter: [line(45_000_000)],
		},
		{
			id: "envelope.left",
			currency: "ARS",
			before: line(10_000_000),
			after: line(260_000_000),
			delta: line(250_000_000),
			figureAfter: [line(260_000_000)],
		},
		{
			id: "netWorthChange.income",
			currency: "ARS",
			before: null,
			after: line(1),
			delta: line(1),
			figureAfter: [line(1)],
		},
	],
	unchanged: [
		{ id: "spent", lines: [line(5_000_000)] },
		{ id: "accounts.balance", lines: [line(1)] },
		{ id: "netWorthChange.spent", lines: [line(1)] },
	],
	unavailable: [
		{ id: "budget.leftToSpend", before: null, after: null },
		{ id: "owed.owedToYou", before: null, after: [line(1)] },
	],
};

describe("changeLines", () => {
	const lines = changeLines(incomeDiff);

	it("orders the places that move like the web and hides net worth parts", () => {
		expect(lines.moved.map((m) => m.figure)).toEqual([
			"envelope.left",
			"budget.notPlannedYet",
		]);
		expect(lines.moved[0]).toMatchObject({
			key: "envelope.left-ARS",
			delta: line(250_000_000),
			after: line(260_000_000),
		});
	});

	it("lists what stays, with the account balance read as accounts", () => {
		expect(lines.stays).toEqual(["spent", "accounts"]);
	});

	it("lists what could not be read, except budget figures that read nothing", () => {
		expect(lines.unknown).toEqual(["owed.owedToYou"]);
	});

	it("keeps a figure that moved out of what stays", () => {
		const both = changeLines({
			...incomeDiff,
			unchanged: [{ id: "envelope.left", lines: [line(1)] }],
		});
		expect(both.stays).toEqual([]);
	});

	it("leaves percent lines out", () => {
		const pct = changeLines({
			...incomeDiff,
			changes: [
				{
					id: "budget.progress",
					currency: "%",
					before: null,
					after: line(5000, "%"),
					delta: line(5000, "%"),
					figureAfter: [],
				},
			],
		});
		expect(pct.moved).toEqual([]);
	});
});

describe("fetchPreview", () => {
	const write: PendingWrite = {
		entity: "income",
		label: "Grupo Andino",
		body: { id: "x", title: "Grupo Andino", amount: "1.00", currency: "ARS" },
	};
	const apiWith = (previewCreate: () => Promise<unknown>) =>
		({ income: { previewCreate } }) as unknown as RetrospendClient;

	it("returns the server's dry run for the same body Save sends", async () => {
		const seen: unknown[] = [];
		const api = apiWith(async (...args: unknown[]) => {
			seen.push(args[0]);
			return incomeDiff;
		});
		expect(await fetchPreview(api, write)).toEqual({
			status: "ready",
			diff: incomeDiff,
		});
		expect(seen).toEqual([write.body]);
	});

	it("says offline when the server was not reached", async () => {
		const api = apiWith(async () => {
			throw new TypeError("Network request failed");
		});
		expect(await fetchPreview(api, write)).toEqual({ status: "offline" });
	});

	it("says refused when the server rejects the dry run, even with a 500", async () => {
		for (const status of [409, 500]) {
			const api = apiWith(async () => {
				throw Object.assign(new Error("no rate"), { status });
			});
			expect(await fetchPreview(api, write)).toEqual({ status: "refused" });
		}
	});
});

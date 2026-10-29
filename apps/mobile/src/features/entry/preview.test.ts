import type { RetrospendClient } from "@retrospend/api-client";
import type { PendingWrite } from "./draft";
import {
	changeLines,
	fetchPreview,
	type PreviewDto,
	planOf,
	sharesOf,
	splitSharesOf,
} from "./preview";

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

	it("marks a converted total as approximate", () => {
		const approx = changeLines({
			...incomeDiff,
			changes: incomeDiff.changes
				.slice(1, 2)
				.map((c) => ({ ...c, approx: true as const })),
		});
		expect(approx.moved[0]?.approx).toBe(true);
		expect(lines.moved[0]?.approx).toBe(false);
	});
});

describe("sharesOf", () => {
	const share = (
		id: string,
		before: number | null,
		after: number | null,
		you = false,
	) => ({
		type: "user",
		id,
		name: id,
		you,
		before: before === null ? null : line(before),
		after: after === null ? null : line(after),
	});
	const edit = (shares: unknown[]): PreviewDto => ({
		changes: [],
		unchanged: [],
		unavailable: [],
		detail: { kind: "sharedExpense.update", shares },
	});

	it("lists the shares that move, you first, and leaves the rest out", () => {
		const out = sharesOf(
			edit([
				share("ana", 3000, 4000),
				share("same", 100, 100),
				share("me", 6000, 8000, true),
				share("gone", 500, null),
			]),
		);
		expect(out?.map((s) => s.name)).toEqual(["me", "ana", "gone"]);
		expect(out?.[2]).toMatchObject({ before: line(500), after: null });
	});

	it("is an empty list when no share moves, and null for other writes", () => {
		expect(sharesOf(edit([share("same", 100, 100)]))).toEqual([]);
		expect(sharesOf(incomeDiff)).toBeNull();
	});
});

describe("splitSharesOf", () => {
	const add = (shares: unknown[]): PreviewDto => ({
		changes: [],
		unchanged: [],
		unavailable: [],
		detail: { kind: "sharedExpense.create", shares },
	});

	it("keys each new share by person, as the server split it", () => {
		expect(
			splitSharesOf(
				add([
					{ type: "user", id: "me", before: null, after: line(5001) },
					{ type: "shadow", id: "ana", before: null, after: line(5000) },
				]),
			),
		).toEqual([
			{ key: "user:me", share: line(5001) },
			{ key: "shadow:ana", share: line(5000) },
		]);
	});

	it("is null for an edit or any other write", () => {
		expect(splitSharesOf(incomeDiff)).toBeNull();
		expect(
			splitSharesOf({
				...add([]),
				detail: { kind: "sharedExpense.update", shares: [] },
			}),
		).toBeNull();
	});
});

describe("fetchPreview", () => {
	const write: PendingWrite = {
		entity: "income",
		label: "Grupo Andino",
		body: { id: "x", title: "Grupo Andino", amount: "1.00", currency: "ARS" },
	};
	const apiWith = (previewCreate: (...args: unknown[]) => Promise<unknown>) =>
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
				throw Object.assign(new Error("no"), { status });
			});
			expect(await fetchPreview(api, write)).toEqual({
				status: "refused",
				reason: "other",
				currency: "ARS",
			});
		}
	});

	it("names a missing rate, so the screen can say No rate yet", async () => {
		const api = apiWith(async () => {
			throw Object.assign(new Error("No rate for UYU"), {
				status: 422,
				code: "missing_rate",
			});
		});
		expect(
			await fetchPreview(api, {
				...write,
				body: { ...write.body, currency: "UYU" },
			}),
		).toEqual({ status: "refused", reason: "missingRate", currency: "UYU" });
	});
});

describe("planOf", () => {
	const none: PreviewDto = { changes: [], unchanged: [], unavailable: [] };
	const withPlan = (plan: Record<string, unknown>): PreviewDto => ({
		...none,
		detail: { kind: "income.add", plan },
	});

	it("lists the lines the plan would write and what stays", () => {
		const plan = planOf(
			withPlan({
				applied: true,
				reason: null,
				lines: [
					{ envelopeId: "rent", amount: line(250_000_000), step: "PLAN" },
				],
				rest: line(45_000_000),
			}),
		);
		expect(plan).toEqual({
			applied: true,
			reason: null,
			lines: [{ envelopeId: "rent", amount: line(250_000_000) }],
			rest: line(45_000_000),
		});
	});

	it("says why it could not run", () => {
		const plan = planOf(
			withPlan({
				applied: false,
				reason: "no_envelope_budget",
				lines: [],
				rest: null,
			}),
		);
		expect(plan).toMatchObject({
			applied: false,
			reason: "no_envelope_budget",
		});
	});

	it("shows nothing when the plan was not asked for or the write has none", () => {
		expect(
			planOf(withPlan({ applied: false, reason: "not_requested", lines: [] })),
		).toBeNull();
		expect(planOf(none)).toBeNull();
	});
});

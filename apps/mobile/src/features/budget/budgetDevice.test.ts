import type { RetrospendClient } from "@retrospend/api-client";
import {
	type BudgetMonth,
	fetchBudget,
	type Verdict,
	verdictViewOf,
} from "./source";

// The Budget read with the dev flag's device engine. The screen gets the
// server's answer, always and at once. On the default read the device is asked
// to compare the "budget" screen in the background, handed a callback that
// reads the server's verdict again through this screen's own query; an
// explicit month is never compared. The book is in pesos.

const ars = (minor: number) => ({ minor, currency: "ARS" });

const verdict = (minor: number, over: Partial<Verdict> = {}) =>
	({
		style: "FLEX",
		month: 202610,
		lead: {
			kind: "LEFT_TO_SPEND",
			figureId: "budget.leftToSpend",
			amount: ars(minor),
		},
		state: "ON_TRACK",
		action: null,
		incomplete: false,
		...over,
	}) as Verdict;

const server = (o: Partial<BudgetMonth> = {}) =>
	({
		book: { id: "book", currency: "ARS", style: "FLEX", paused: false },
		month: { key: 202610, state: "OPEN" },
		today: "2026-10-15",
		incomplete: false,
		approximate: false,
		verdict: verdict(5_000_000),
		groups: [
			{ envelopes: [{ id: "e1" }, { id: "e2" }] },
			{ envelopes: [{ id: "e3" }] },
		],
		...o,
	}) as BudgetMonth;

const api = (month: BudgetMonth | null) =>
	({
		budget: {
			month: jest.fn(async () => month),
			payoffProjection: jest.fn(async () => null),
		},
	}) as unknown as RetrospendClient;

type Callback = () => Promise<unknown>;
const device = () => ({
	compare: jest.fn(
		async (_screen: string, _narrowings?: object, _verdict?: Callback) => null,
	),
});

describe("the screen", () => {
	it("gets the server's answer, whatever the device holds", async () => {
		const month = server();
		const got = await fetchBudget(api(month), null, device())();
		expect(got).toEqual({ month, payoff: null });
		expect(got.month).toBe(month);
	});

	it("does not wait for the device", async () => {
		const month = server();
		const slow = device();
		slow.compare.mockReturnValue(new Promise(() => {}));
		const got = await fetchBudget(api(month), null, slow)();
		expect(got.month).toBe(month);
	});

	it("is today's call with no device", async () => {
		for (const none of [undefined, null])
			expect((await fetchBudget(api(server()), null, none)()).month).toEqual(
				server(),
			);
	});
});

describe("the compare", () => {
	it("is asked for the budget screen on the default read, with the verdict the screen showed", async () => {
		const source = device();
		const month = server();
		await fetchBudget(api(month), null, source)();
		expect(source.compare).toHaveBeenCalledTimes(1);
		const [screen, narrowings, read] = source.compare.mock.calls[0] ?? [];
		expect(screen).toBe("budget");
		// Every envelope the page lists, in its order, for envelope.left and .spent.
		expect(narrowings).toEqual({ envelopeId: ["e1", "e2", "e3"] });
		// The callback re-runs the screen's own query and maps it, so the
		// compare holds what is on screen.
		expect(await read?.()).toEqual(verdictViewOf(month));
	});

	it("is not asked for an explicit month, the current one included", async () => {
		const source = device();
		await fetchBudget(api(server()), 202610, source)();
		expect(source.compare).not.toHaveBeenCalled();
	});
});

describe("the verdict as the compare holds it", () => {
	it("carries the book, month, day, style, state, action and lead", () => {
		expect(verdictViewOf(server())).toEqual({
			bookId: "book",
			currency: "ARS",
			month: 202610,
			today: "2026-10-15",
			style: "FLEX",
			incomplete: false,
			state: "ON_TRACK",
			action: null,
			lead: { figureId: "budget.leftToSpend", amount: ars(5_000_000) },
		});
	});

	it.each([
		["the month is incomplete", { incomplete: true }],
		["the month is approximate", { approximate: true }],
		[
			"the verdict is incomplete",
			{ verdict: verdict(1, { incomplete: true }) },
		],
	] as [string, Partial<BudgetMonth>][])(
		"marks it incomplete when %s",
		(_n, o) => {
			expect(verdictViewOf(server(o)).incomplete).toBe(true);
		},
	);
});

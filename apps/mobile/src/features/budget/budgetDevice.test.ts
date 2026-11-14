import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceBudget, DeviceRead } from "@/data/device-engine";
import {
	type BudgetMonth,
	fetchBudget,
	type Verdict,
	verdictParts,
} from "./source";

// The Budget read with the dev flag's device engine. The screen gets the
// server's answer, always and at once. On the default read the device's
// verdict is held against it in the background, after a fresh pull and only
// when both describe the same month of the same book; a difference is pulled
// again once, then reported with ids and parts, never amounts. The book is in
// pesos.

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
		...o,
	}) as BudgetMonth;

const deviceBudget = (o: Partial<DeviceBudget> = {}): DeviceBudget => ({
	bookId: "book",
	currency: "ARS",
	month: 202610,
	today: "2026-10-15",
	approximate: false,
	incomplete: false,
	verdict: verdict(4_999_900),
	...o,
});

const read = (o: Partial<DeviceRead> = {}): DeviceRead => ({
	homeCurrency: "ARS",
	budgetReady: true,
	budget: deviceBudget(),
	readings: new Map(),
	...o,
});

const api = (month: BudgetMonth | null) =>
	({
		budget: {
			month: jest.fn(async () => month),
			payoffProjection: jest.fn(async () => null),
		},
	}) as unknown as RetrospendClient;

/** A device that answers each read in turn, the last one again. */
const device = (...answers: (DeviceRead | null)[]) => {
	let at = 0;
	return {
		read: jest.fn(async (_ids: readonly string[], _o?: unknown) => {
			const answer = answers[Math.min(at, answers.length - 1)] ?? null;
			at += 1;
			return answer;
		}),
		verify: jest.fn(async (_ids: readonly string[]) => {}),
		reportVerdict: jest.fn(),
	};
};

/** The fetch, then the background check it started. */
const run = async (
	month: BudgetMonth | null,
	source: ReturnType<typeof device>,
	asked: number | null = null,
) => {
	const got = await fetchBudget(api(month), asked, source)();
	await new Promise((resolve) => setTimeout(resolve, 0));
	return got;
};

describe("the screen", () => {
	it("gets the server's answer, whatever the device says", async () => {
		const month = server();
		const got = await run(month, device(read()));
		expect(got).toEqual({ month, payoff: null });
		expect(got.month).toBe(month);
		expect(month.verdict.lead.amount).toEqual(ars(5_000_000));
	});

	it("does not wait for the device", async () => {
		const month = server();
		const slow = device();
		slow.read.mockReturnValue(new Promise(() => {}));
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

describe("the check against the device", () => {
	it("asks for a fresh read of the budget on the default read and says nothing when the verdicts agree", async () => {
		const source = device(
			read({ budget: deviceBudget({ verdict: verdict(5_000_000) }) }),
		);
		await run(server(), source);
		expect(source.read).toHaveBeenCalledTimes(1);
		expect(source.read).toHaveBeenCalledWith([], { fresh: true, budget: true });
		expect(source.reportVerdict).not.toHaveBeenCalled();
	});

	// The sync feed may hold a change back for a moment: the second pull has it.
	it("pulls once more on a difference and says nothing when that pull catches up", async () => {
		const source = device(
			read(),
			read({ budget: deviceBudget({ verdict: verdict(5_000_000) }) }),
		);
		await run(server(), source);
		expect(source.read).toHaveBeenCalledTimes(2);
		expect(source.read.mock.calls[1]).toEqual([
			[],
			{ fresh: true, budget: true },
		]);
		expect(source.reportVerdict).not.toHaveBeenCalled();
	});

	it("reports what still differs after the second pull, once", async () => {
		const source = device(read());
		const month = server();
		await run(month, source);
		expect(source.read).toHaveBeenCalledTimes(2);
		expect(source.reportVerdict).toHaveBeenCalledTimes(1);
		expect(source.reportVerdict).toHaveBeenCalledWith(
			"budget.leftToSpend",
			["amount"],
			{ device: verdict(4_999_900), server: month.verdict },
		);
	});

	it("reports nothing when the second read cannot be compared", async () => {
		const source = device(read(), null);
		await run(server(), source);
		expect(source.reportVerdict).not.toHaveBeenCalled();
	});

	it.each([
		["state", { state: "OVER_BUDGET" }],
		["action", { action: "COVER" }],
		[
			"figure",
			{
				lead: {
					kind: "TO_ASSIGN",
					figureId: "budget.notPlannedYet",
					amount: ars(5_000_000),
				},
			},
		],
		[
			"amount",
			{
				lead: {
					kind: "LEFT_TO_SPEND",
					figureId: "budget.leftToSpend",
					amount: ars(5_000_001),
				},
			},
		],
		[
			"amount",
			{
				lead: {
					kind: "LEFT_TO_SPEND",
					figureId: "budget.leftToSpend",
					amount: { minor: 5_000_000, currency: "USD" },
				},
			},
		],
	] as [string, Partial<Verdict>][])(
		"names %s when it differs",
		(part, over) => {
			expect(
				verdictParts(verdict(5_000_000, over), verdict(5_000_000)),
			).toEqual(expect.arrayContaining([part]));
			expect(verdictParts(verdict(5_000_000), verdict(5_000_000))).toEqual([]);
		},
	);

	// Each of these would otherwise be compared (the device verdict differs).
	describe("compares nothing", () => {
		const skipped = (
			name: string,
			month: BudgetMonth | null,
			answer: DeviceRead | null,
		) =>
			it(name, async () => {
				const source = device(answer);
				await run(month, source);
				expect(source.read).toHaveBeenCalledTimes(1);
				expect(source.reportVerdict).not.toHaveBeenCalled();
			});
		const withBudget = (o: Partial<DeviceBudget>) =>
			read({ budget: deviceBudget(o) });

		it("for an explicit month, the current one included, and does not ask the device", async () => {
			const source = device(read());
			await run(server(), source, 202610);
			expect(source.read).not.toHaveBeenCalled();
			expect(source.reportVerdict).not.toHaveBeenCalled();
		});
		skipped("when the device holds nothing it can trust", server(), null);
		skipped(
			"when its budget is not ready",
			server(),
			read({ budgetReady: false }),
		);
		skipped("when its budget was not read", server(), read({ budget: null }));
		skipped("when there is no budget", null, read());
		skipped("for another book", server(), withBudget({ bookId: "other" }));
		skipped(
			"for the book in another currency",
			server(),
			withBudget({ currency: "USD" }),
		);
		skipped("for another month", server(), withBudget({ month: 202609 }));
		skipped("for another day", server(), withBudget({ today: "2026-10-16" }));
		skipped(
			"for another style",
			server(),
			withBudget({ verdict: verdict(1, { style: "WEEKLY" }) }),
		);
		skipped(
			"when the server's month is incomplete",
			server({ incomplete: true }),
			read(),
		);
		skipped(
			"when the server's month is approximate",
			server({ approximate: true }),
			read(),
		);
		skipped(
			"when the server's verdict is incomplete",
			server({ verdict: verdict(5_000_000, { incomplete: true }) }),
			read(),
		);
		skipped(
			"when the device's month is incomplete",
			server(),
			withBudget({ incomplete: true }),
		);
		skipped(
			"when the device's month is approximate",
			server(),
			withBudget({ approximate: true }),
		);
		skipped(
			"when the device's verdict is incomplete",
			server(),
			withBudget({ verdict: verdict(1, { incomplete: true }) }),
		);
		skipped(
			"for a Pay off debt book, which leads with its own hero",
			server({
				book: {
					id: "book",
					currency: "ARS",
					style: "DEBT_PAYOFF",
					paused: false,
				},
			} as Partial<BudgetMonth>),
			read(),
		);
	});
});

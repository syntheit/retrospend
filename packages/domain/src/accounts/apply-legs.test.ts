import { describe, expect, it } from "vitest";
import {
	applyLegs,
	type Leg,
	type LegAccount,
	type LegSnapshot,
	type LegState,
	pgDivide,
} from "./apply-legs";

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const at = (n: number, hour: number) => new Date(Date.UTC(2026, 0, n, hour));

function account(over: Partial<LegAccount> = {}): LegAccount {
	return {
		type: "CASH",
		currency: "ARS",
		balance: "0",
		countedUnits: "0",
		exchangeRate: null,
		...over,
	};
}

function snapshot(over: Partial<LegSnapshot> & { id: string }): LegSnapshot {
	return {
		accountId: "a",
		date: day(10),
		balance: "0",
		balanceInUSD: "0",
		currency: null,
		recordedAt: at(10, 12),
		...over,
	};
}

function leg(over: Partial<Leg> = {}): Leg {
	return {
		accountId: "a",
		amount: "0",
		date: day(10),
		createdAt: at(10, 8),
		source: "TRANSFER",
		countedUnits: "0",
		...over,
	};
}

function state(
	accounts: Record<string, LegAccount>,
	snapshots: LegSnapshot[] = [],
): LegState {
	return { accounts: new Map(Object.entries(accounts)), snapshots };
}

const balanceOf = (s: LegState, id = "a") =>
	s.accounts.get(id)?.balance.toString();
const countedOf = (s: LegState, id = "a") =>
	s.accounts.get(id)?.countedUnits.toString();
const snapOf = (s: LegState, id: string) => {
	const found = s.snapshots.find((x) => x.id === id);
	return `${found?.balance} / ${found?.balanceInUSD}`;
};

describe("pgDivide", () => {
	// Hand-derived from select_div_scale: 16 significant digits at least, and
	// the quotient's leading base-10000 digit decides how many decimals that is.
	it("keeps 20 decimals when the numerator's leading digit is not above the divisor's", () => {
		expect(pgDivide("1", "3", 0, 0).toFixed()).toBe("0.33333333333333333333");
		expect(pgDivide("2", "3", 0, 0).toFixed()).toBe("0.66666666666666666667");
	});

	it("keeps 16 decimals when the leading digit is above", () => {
		expect(pgDivide("10", "3", 0, 0).toFixed()).toBe("3.3333333333333333");
	});

	it("keeps fewer decimals as the quotient grows, down to 12", () => {
		// 40000 / 3: the numerator's leading base-10000 digit (4) is above 3 and
		// it sits one base-10000 place higher, so qweight 1 and rscale 16 - 4.
		expect(pgDivide("40000", "3", 0, 0).toFixed()).toBe("13333.333333333333");
	});

	it("never keeps fewer decimals than an operand has", () => {
		expect(pgDivide("40000", "3", 14, 0).toFixed()).toBe(
			"13333.33333333333333",
		);
	});
});

describe("applyLegs: leg kinds", () => {
	it("an income into an ARS account adds its signed amount", () => {
		const out = applyLegs(state({ a: account({ balance: "10000" }) }), [
			{ op: "insert", leg: leg({ source: "INCOME", amount: "1500.50" }) },
		]);
		expect(balanceOf(out)).toBe("11500.5");
	});

	it("a transfer out of the account takes its negative amount", () => {
		const out = applyLegs(state({ a: account({ balance: "10000" }) }), [
			{ op: "insert", leg: leg({ amount: "-2500.25" }) },
		]);
		expect(balanceOf(out)).toBe("7499.75");
	});

	it("a fee leg moves the balance like a transfer leg", () => {
		const out = applyLegs(state({ a: account({ balance: "100" }) }), [
			{ op: "insert", leg: leg({ source: "FEE", amount: "-1.5" }) },
		]);
		expect(balanceOf(out)).toBe("98.5");
	});

	it("a balance update leg never moves the balance", () => {
		const out = applyLegs(state({ a: account({ balance: "100" }) }), [
			{ op: "insert", leg: leg({ source: "BALANCE_UPDATE", amount: "40" }) },
		]);
		expect(balanceOf(out)).toBe("100");
	});

	it("a balance update leg still counts its units", () => {
		const out = applyLegs(state({ a: account({ balance: "100" }) }), [
			{
				op: "insert",
				leg: leg({
					source: "BALANCE_UPDATE",
					amount: "40",
					countedUnits: "30",
				}),
			},
		]);
		expect(countedOf(out)).toBe("30");
	});

	it("a leg with no account changes nothing", () => {
		const before = state({ a: account({ balance: "100" }) });
		const out = applyLegs(before, [
			{
				op: "insert",
				leg: leg({ accountId: null, amount: "9", countedUnits: "9" }),
			},
		]);
		expect(balanceOf(out)).toBe("100");
		expect(countedOf(out)).toBe("0");
	});

	it("a leg whose account is gone changes nothing", () => {
		const out = applyLegs(state({ a: account({ balance: "100" }) }), [
			{ op: "delete", leg: leg({ accountId: "gone", amount: "50" }) },
		]);
		expect(balanceOf(out)).toBe("100");
	});

	it("does not change its input", () => {
		const before = state({ a: account({ balance: "100" }) }, [
			snapshot({ id: "s", balance: "100", balanceInUSD: "1" }),
		]);
		applyLegs(before, [{ op: "insert", leg: leg({ amount: "50" }) }]);
		expect(before.accounts.get("a")?.balance).toBe("100");
		expect(before.snapshots[0]?.balance).toBe("100");
	});
});

describe("applyLegs: liabilities store what you owe", () => {
	it("a payment (+) on a card lowers what is owed", () => {
		const out = applyLegs(
			state({ a: account({ type: "LIABILITY_CREDIT_CARD", balance: "1000" }) }),
			[{ op: "insert", leg: leg({ source: "TRANSFER", amount: "300" }) }],
		);
		expect(balanceOf(out)).toBe("700");
	});

	it("a charge (-) on a loan raises what is owed", () => {
		const out = applyLegs(
			state({ a: account({ type: "LIABILITY_LOAN", balance: "1000" }) }),
			[{ op: "insert", leg: leg({ amount: "-50.5" }) }],
		);
		expect(balanceOf(out)).toBe("1050.5");
	});

	it("deleting the payment puts the debt back", () => {
		const paid = leg({ amount: "300" });
		const out = applyLegs(
			state({ a: account({ type: "LIABILITY_MORTGAGE", balance: "700" }) }),
			[{ op: "delete", leg: paid }],
		);
		expect(balanceOf(out)).toBe("1000");
	});

	it("a liability counts no units, whatever the leg says", () => {
		const out = applyLegs(
			state({ a: account({ type: "LIABILITY_LOAN", balance: "1000" }) }),
			[{ op: "insert", leg: leg({ amount: "10", countedUnits: "10" }) }],
		);
		expect(countedOf(out)).toBe("0");
	});
});

describe("applyLegs: reversals and edits", () => {
	it("an insert then its delete leaves the account as it was", () => {
		const l = leg({ amount: "1234.56" });
		const out = applyLegs(state({ a: account({ balance: "50" }) }), [
			{ op: "insert", leg: l },
			{ op: "delete", leg: l },
		]);
		expect(balanceOf(out)).toBe("50");
	});

	it("raising an amount moves the balance by the difference", () => {
		const out = applyLegs(state({ a: account({ balance: "350" }) }), [
			{
				op: "update",
				old: leg({ amount: "100" }),
				next: leg({ amount: "250" }),
			},
		]);
		expect(balanceOf(out)).toBe("500");
	});

	it("moving a leg to another account takes it from one and gives it to the other", () => {
		const out = applyLegs(
			state({
				a: account({ balance: "300" }),
				b: account({ balance: "10", currency: "USD" }),
			}),
			[
				{
					op: "update",
					old: leg({ accountId: "a", amount: "100" }),
					next: leg({ accountId: "b", amount: "100" }),
				},
			],
		);
		expect(balanceOf(out, "a")).toBe("200");
		expect(balanceOf(out, "b")).toBe("110");
	});

	it("an edit onto a liability flips the sign it is stored with", () => {
		const out = applyLegs(
			state({
				a: account({ balance: "300" }),
				b: account({ type: "LIABILITY_CREDIT_CARD", balance: "500" }),
			}),
			[
				{
					op: "update",
					old: leg({ accountId: "a", amount: "100" }),
					next: leg({ accountId: "b", amount: "100" }),
				},
			],
		);
		expect(balanceOf(out, "a")).toBe("200");
		expect(balanceOf(out, "b")).toBe("400");
	});

	it("changing the source from a transfer to a balance update gives the money back", () => {
		const out = applyLegs(state({ a: account({ balance: "300" }) }), [
			{
				op: "update",
				old: leg({ amount: "100", source: "TRANSFER" }),
				next: leg({ amount: "100", source: "BALANCE_UPDATE" }),
			},
		]);
		expect(balanceOf(out)).toBe("200");
	});

	it("an update that keeps account, amount, date, createdAt and source moves no money", () => {
		const out = applyLegs(
			state({ a: account({ balance: "300", countedUnits: "20" }) }),
			[
				{
					op: "update",
					old: leg({ amount: "100.00", countedUnits: "20" }),
					next: leg({ amount: "100", countedUnits: "50" }),
				},
			],
		);
		expect(balanceOf(out)).toBe("300");
		// -20 then +50 on top of 20, capped at the balance of 300.
		expect(countedOf(out)).toBe("50");
	});

	it("a changed date alone does move money (out and back in, same total) and refreshes snapshots", () => {
		const out = applyLegs(
			state({ a: account({ type: "CASH", currency: "USD", balance: "100" }) }, [
				snapshot({
					id: "s",
					date: day(12),
					balance: "100",
					balanceInUSD: "100",
					recordedAt: at(12, 12),
				}),
			]),
			[
				{
					op: "update",
					old: leg({ amount: "40", date: day(5) }),
					next: leg({ amount: "40", date: day(20) }),
				},
			],
		);
		expect(balanceOf(out)).toBe("100");
		// The day-12 snapshot held the leg dated day 5, and loses it when the
		// leg moves to day 20.
		expect(snapOf(out, "s")).toBe("60 / 60");
	});

	it("an insert that would overflow the balance column throws and changes nothing", () => {
		const before = state({ a: account({ balance: "99999999999" }) });
		expect(() =>
			applyLegs(before, [{ op: "insert", leg: leg({ amount: "2" }) }]),
		).toThrow(RangeError);
		expect(balanceOf(before)).toBe("99999999999");
	});
});

describe("applyLegs: counted units", () => {
	it("are added with the leg and capped at what the account holds", () => {
		const out = applyLegs(state({ a: account({ balance: "100" }) }), [
			{ op: "insert", leg: leg({ amount: "50", countedUnits: "500" }) },
		]);
		// Balance 150, so at most 150 units count.
		expect(countedOf(out)).toBe("150");
	});

	it("go with the leg and never below zero", () => {
		const l = leg({ amount: "50", countedUnits: "50" });
		const out = applyLegs(
			state({ a: account({ balance: "200", countedUnits: "30" }) }),
			[{ op: "delete", leg: l }],
		);
		// 30 - 50 clamps to 0; balance 150.
		expect(countedOf(out)).toBe("0");
		expect(balanceOf(out)).toBe("150");
	});

	it("a withdrawal that leaves less than counted trims them to the balance", () => {
		const out = applyLegs(
			state({ a: account({ balance: "100", countedUnits: "80" }) }),
			[{ op: "insert", leg: leg({ amount: "-60" }) }],
		);
		expect(balanceOf(out)).toBe("40");
		expect(countedOf(out)).toBe("40");
	});

	it("a negative balance counts nothing", () => {
		const out = applyLegs(
			state({ a: account({ balance: "10", countedUnits: "10" }) }),
			[{ op: "insert", leg: leg({ amount: "-25" }) }],
		);
		expect(balanceOf(out)).toBe("-15");
		expect(countedOf(out)).toBe("0");
	});
});

describe("applyLegs: balance updates already holding the leg", () => {
	it("a USD snapshot dated on the leg's day and recorded after it moves with it", () => {
		const out = applyLegs(
			state({ a: account({ currency: "USD", balance: "100" }) }, [
				snapshot({
					id: "s",
					balance: "100",
					balanceInUSD: "100",
					currency: "USD",
					date: day(10),
					recordedAt: at(10, 12),
				}),
			]),
			[
				{
					op: "insert",
					leg: leg({ amount: "25.255", createdAt: at(10, 8) }),
				},
			],
		);
		// 125.255 cast to cents rounds away from zero.
		expect(snapOf(out, "s")).toBe("125.255 / 125.26");
	});

	it("a snapshot dated before the leg, or recorded before it was created, stays", () => {
		const out = applyLegs(
			state({ a: account({ balance: "100" }) }, [
				snapshot({
					id: "early",
					date: day(9),
					balance: "100",
					balanceInUSD: "1",
					recordedAt: at(10, 12),
				}),
				snapshot({
					id: "older",
					date: day(11),
					balance: "100",
					balanceInUSD: "1",
					recordedAt: at(10, 7),
				}),
			]),
			[{ op: "insert", leg: leg({ amount: "50", createdAt: at(10, 8) }) }],
		);
		expect(snapOf(out, "early")).toBe("100 / 1");
		expect(snapOf(out, "older")).toBe("100 / 1");
	});

	it("another account's snapshot stays", () => {
		const out = applyLegs(
			state({ a: account(), b: account() }, [
				snapshot({ id: "s", accountId: "b", balance: "5", balanceInUSD: "5" }),
			]),
			[{ op: "insert", leg: leg({ amount: "50" }) }],
		);
		expect(snapOf(out, "s")).toBe("5 / 5");
	});

	it("an ARS snapshot scales its USD value with its balance", () => {
		const out = applyLegs(
			state({ a: account({ balance: "150000" }) }, [
				snapshot({ id: "s", balance: "150000", balanceInUSD: "100" }),
			]),
			[{ op: "insert", leg: leg({ amount: "50000" }) }],
		);
		// 100 * 200000 / 150000 = 133.333...
		expect(snapOf(out, "s")).toBe("200000 / 133.33");
	});

	it("rounds a USD value that lands on a tie to even", () => {
		const out = applyLegs(
			state({ a: account({ balance: "8" }) }, [
				snapshot({ id: "s", balance: "8", balanceInUSD: "1" }),
			]),
			[{ op: "insert", leg: leg({ amount: "1" }) }],
		);
		// 1 * 9 / 8 = 1.125: 2 is even, so 1.12 (half away from zero gave 1.13).
		expect(snapOf(out, "s")).toBe("9 / 1.12");
	});

	it("rounds a tie whose lower neighbor is odd up", () => {
		const out = applyLegs(
			state({ a: account({ balance: "8" }) }, [
				snapshot({ id: "s", balance: "8", balanceInUSD: "1" }),
			]),
			[{ op: "insert", leg: leg({ amount: "-1" }) }],
		);
		// 1 * 7 / 8 = 0.875: 7 is odd, so 0.88.
		expect(snapOf(out, "s")).toBe("7 / 0.88");
	});

	it("rounds a negative tie to even, by its magnitude", () => {
		const out = applyLegs(
			state({ a: account({ type: "LIABILITY_LOAN", balance: "8" }) }, [
				snapshot({ id: "s", balance: "8", balanceInUSD: "-1" }),
			]),
			// A payment of 3 on a liability: effect -3, balance 5, -1 * 5 / 8.
			[{ op: "insert", leg: leg({ amount: "3" }) }],
		);
		// -0.625: 2 is even, so -0.62 (half away from zero gave -0.63).
		expect(snapOf(out, "s")).toBe("5 / -0.62");
	});

	it("rounds a negative tie whose lower magnitude is odd away from zero", () => {
		const out = applyLegs(
			state({ a: account({ type: "LIABILITY_LOAN", balance: "8" }) }, [
				snapshot({ id: "s", balance: "8", balanceInUSD: "-1" }),
			]),
			// Effect -1, balance 7: -1 * 7 / 8 = -0.875, 7 is odd, so -0.88.
			[{ op: "insert", leg: leg({ amount: "1" }) }],
		);
		expect(snapOf(out, "s")).toBe("7 / -0.88");
	});

	it("rounds a USD snapshot's 8-decimal balance to cents, ties to even", () => {
		const out = applyLegs(
			state({ a: account({ currency: "USD", balance: "1" }) }, [
				snapshot({ id: "up", balance: "1", balanceInUSD: "1" }),
				snapshot({
					id: "down",
					date: day(11),
					balance: "-1.03",
					balanceInUSD: "-1.03",
				}),
			]),
			[{ op: "insert", leg: leg({ amount: "0.005" }) }],
		);
		// 1.005 to 1.00 and -1.025 to -1.02 (2 even); the old cast gave 1.01
		// and -1.03.
		expect(snapOf(out, "up")).toBe("1.005 / 1");
		expect(snapOf(out, "down")).toBe("-1.025 / -1.02");
	});

	it("a JPY tie and a KWD tie round to even too", () => {
		const jpy = applyLegs(
			state({ a: account({ currency: "JPY", balance: "2" }) }, [
				snapshot({ id: "s", balance: "2", balanceInUSD: "0.05" }),
			]),
			[{ op: "insert", leg: leg({ amount: "3" }) }],
		);
		// 0.05 * 5 / 2 = 0.125 to 0.12.
		expect(snapOf(jpy, "s")).toBe("5 / 0.12");
		const kwd = applyLegs(
			state({ a: account({ currency: "KWD", balance: "0.002" }) }, [
				snapshot({ id: "s", balance: "0.002", balanceInUSD: "0.05" }),
			]),
			[{ op: "insert", leg: leg({ amount: "0.003" }) }],
		);
		// 0.05 * 0.005 / 0.002 = 0.125 to 0.12.
		expect(snapOf(kwd, "s")).toBe("0.005 / 0.12");
	});

	it("a JPY snapshot (no decimals) scales the same way", () => {
		const out = applyLegs(
			state({ a: account({ currency: "JPY", balance: "30000" }) }, [
				snapshot({ id: "s", balance: "30000", balanceInUSD: "200" }),
			]),
			[{ op: "insert", leg: leg({ amount: "-7500" }) }],
		);
		// 200 * 22500 / 30000 = 150.
		expect(snapOf(out, "s")).toBe("22500 / 150");
	});

	it("a KWD snapshot (three decimals) scales the same way", () => {
		const out = applyLegs(
			state({ a: account({ currency: "KWD", balance: "100.250" }) }, [
				snapshot({ id: "s", balance: "100.250", balanceInUSD: "325.50" }),
			]),
			[{ op: "insert", leg: leg({ amount: "10.125" }) }],
		);
		// 325.50 * 110.375 / 100.25 = 358.3746...
		expect(snapOf(out, "s")).toBe("110.375 / 358.37");
	});

	it("a snapshot's own currency decides whether it is USD, not the account's", () => {
		const out = applyLegs(
			state({ a: account({ currency: "ARS", balance: "100" }) }, [
				snapshot({
					id: "s",
					balance: "100",
					balanceInUSD: "100",
					currency: "USD",
				}),
			]),
			[{ op: "insert", leg: leg({ amount: "11" }) }],
		);
		expect(snapOf(out, "s")).toBe("111 / 111");
	});

	it("a liability snapshot moves with the stored (owed) sign", () => {
		const out = applyLegs(
			state(
				{ a: account({ type: "LIABILITY_CREDIT_CARD", balance: "1000" }) },
				[snapshot({ id: "s", balance: "1000", balanceInUSD: "10" })],
			),
			[{ op: "insert", leg: leg({ amount: "250" }) }],
		);
		// Effect -250: 10 * 750 / 1000 = 7.5.
		expect(snapOf(out, "s")).toBe("750 / 7.5");
	});
});

describe("applyLegs: a snapshot that held nothing", () => {
	it("is valued from the nearest other snapshot that held something", () => {
		const out = applyLegs(
			state({ a: account({ balance: "0" }) }, [
				snapshot({
					id: "zero",
					date: day(10),
					balance: "0",
					balanceInUSD: "0",
				}),
				snapshot({
					id: "near",
					date: day(9),
					balance: "1000",
					balanceInUSD: "10",
					recordedAt: at(1, 0),
				}),
				snapshot({
					id: "far",
					date: day(1),
					balance: "1000",
					balanceInUSD: "5",
					recordedAt: at(1, 0),
				}),
			]),
			[{ op: "insert", leg: leg({ amount: "250" }) }],
		);
		// 0.01 USD per ARS from the day-9 snapshot: 250 * 0.01.
		expect(snapOf(out, "zero")).toBe("250 / 2.5");
	});

	it("on a tie in distance takes the later snapshot", () => {
		const out = applyLegs(
			state({ a: account() }, [
				snapshot({ id: "zero", date: day(10) }),
				snapshot({
					id: "before",
					date: day(9),
					balance: "100",
					balanceInUSD: "1",
					recordedAt: at(1, 0),
				}),
				snapshot({
					id: "after",
					date: day(11),
					balance: "100",
					balanceInUSD: "3",
					recordedAt: at(1, 0),
				}),
			]),
			[{ op: "insert", leg: leg({ amount: "100", createdAt: at(1, 0) }) }],
		);
		// 'after' (3 USD per 100) is later; but it also moves, so it is the one
		// the zero snapshot sees only if it was visited first. The zero snapshot
		// comes first here, so it reads the stored 0.03.
		expect(snapOf(out, "zero")).toBe("100 / 3");
	});

	it("a snapshot visited earlier in the same change counts at its new value", () => {
		const out = applyLegs(
			state({ a: account() }, [
				snapshot({
					id: "held",
					date: day(10),
					balance: "100",
					balanceInUSD: "1",
					recordedAt: at(10, 12),
				}),
				snapshot({
					id: "zero",
					date: day(11),
					recordedAt: at(11, 12),
				}),
			]),
			[{ op: "insert", leg: leg({ amount: "100" }) }],
		);
		// 'held' becomes 200 / 2.00 first; zero reads 2/200 = 0.01 USD per unit.
		expect(snapOf(out, "held")).toBe("200 / 2");
		expect(snapOf(out, "zero")).toBe("100 / 1");
	});

	it("moves snapshots oldest first, whatever order they come in", () => {
		const snaps = [
			snapshot({
				id: "later",
				date: day(11),
				balance: "2",
				balanceInUSD: "0.01",
				recordedAt: at(11, 12),
			}),
			snapshot({ id: "zero", date: day(10), recordedAt: at(10, 12) }),
		];
		for (const order of [snaps, [...snaps].reverse()]) {
			const out = applyLegs(state({ a: account({ balance: "2" }) }, order), [
				{ op: "insert", leg: leg({ amount: "1" }) },
			]);
			// 'zero' first: 0.01 / 2 = 0.005 USD per unit, 1 x 0.005 = 0.005 to
			// 0.00 (even). Then 'later': 0.01 * 3 / 2 = 0.015 to 0.02. Valuing
			// 'zero' after 'later' would read 0.02 / 3 and give 0.01.
			expect(snapOf(out, "zero")).toBe("1 / 0");
			expect(snapOf(out, "later")).toBe("3 / 0.02");
			expect(out.snapshots.map((x) => x.id)).toEqual(order.map((x) => x.id));
		}
	});

	it("a tie from 1 / rate rounds to even, either sign", () => {
		const run = (amount: string) =>
			applyLegs(
				state({ a: account({ balance: "0", exchangeRate: "200" }) }, [
					snapshot({ id: "zero", balance: "0", balanceInUSD: "0" }),
				]),
				[{ op: "insert", leg: leg({ amount }) }],
			);
		// 1 / 200 = 0.005 USD per unit: 1 gives 0.005 to 0.00, 3 gives 0.015
		// to 0.02, -5 gives -0.025 to -0.02, -7 gives -0.035 to -0.04.
		expect(snapOf(run("1"), "zero")).toBe("1 / 0");
		expect(snapOf(run("3"), "zero")).toBe("3 / 0.02");
		expect(snapOf(run("-5"), "zero")).toBe("-5 / -0.02");
		expect(snapOf(run("-7"), "zero")).toBe("-7 / -0.04");
	});

	it("a crypto tie from the rate itself rounds to even", () => {
		const out = applyLegs(
			state(
				{
					a: account({
						type: "CRYPTO",
						currency: "BTC",
						balance: "0",
						exchangeRate: "50",
					}),
				},
				[snapshot({ id: "zero", balance: "0", balanceInUSD: "0" })],
			),
			[{ op: "insert", leg: leg({ amount: "0.0001" }) }],
		);
		// 0.0001 BTC x 50 USD = 0.005 to 0.00.
		expect(snapOf(out, "zero")).toBe("0.0001 / 0");
	});

	it("falls back to 1 / rate on a cash account", () => {
		const out = applyLegs(
			state({ a: account({ balance: "0", exchangeRate: "1545" }) }, [
				snapshot({ id: "zero", balance: "0", balanceInUSD: "0" }),
			]),
			[{ op: "insert", leg: leg({ amount: "15450" }) }],
		);
		// 1 / 1545 = 0.00064724919093851133 (20 decimals); times 15450 = 10.000...
		expect(snapOf(out, "zero")).toBe("15450 / 10");
	});

	it("falls back to the rate itself on a crypto account", () => {
		const out = applyLegs(
			state(
				{
					a: account({
						type: "CRYPTO",
						currency: "BTC",
						balance: "0",
						exchangeRate: "65000.5",
					}),
				},
				[snapshot({ id: "zero", balance: "0", balanceInUSD: "0" })],
			),
			[{ op: "insert", leg: leg({ amount: "0.02" }) }],
		);
		// 0.02 * 65000.5 = 1300.01.
		expect(snapOf(out, "zero")).toBe("0.02 / 1300.01");
	});

	it("keeps its USD value when there is no rate to value it by", () => {
		const out = applyLegs(
			state({ a: account({ balance: "0", exchangeRate: null }) }, [
				snapshot({ id: "zero", balance: "0", balanceInUSD: "7" }),
			]),
			[{ op: "insert", leg: leg({ amount: "100" }) }],
		);
		expect(snapOf(out, "zero")).toBe("100 / 7");
	});

	it("a zero-rate account has no rate either", () => {
		const out = applyLegs(
			state({ a: account({ balance: "0", exchangeRate: "0" }) }, [
				snapshot({ id: "zero", balance: "0", balanceInUSD: "7" }),
			]),
			[{ op: "insert", leg: leg({ amount: "100" }) }],
		);
		expect(snapOf(out, "zero")).toBe("100 / 7");
	});

	it("a JPY account valued by its stored rate keeps 20 decimals before rounding", () => {
		const out = applyLegs(
			state(
				{ a: account({ currency: "JPY", balance: "0", exchangeRate: "150" }) },
				[snapshot({ id: "zero", balance: "0", balanceInUSD: "0" })],
			),
			[{ op: "insert", leg: leg({ amount: "3000" }) }],
		);
		// 1/150 = 0.00666666666666666667; 3000 times that is 20.00000000000000001.
		expect(snapOf(out, "zero")).toBe("3000 / 20");
	});
});

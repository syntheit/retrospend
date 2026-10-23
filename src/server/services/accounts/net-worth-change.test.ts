/**
 * netWorthChange over hand-derived ledgers (MONEY-MOVES §2, I10). Rates:
 * ARS Blue 1,468, Official 1,412, MEP 1,449 per USD unless a test moves them.
 * Every case also checks that the parts add up to the change.
 */
import { describe, expect, it } from "vitest";
import { dec } from "~/server/services/envelope/units";
import type { AccountLegSource, AssetType } from "~prisma";
import {
	CHANGE_PARTS,
	type NotTrackedHistory,
	netWorthChange,
} from "./net-worth-change";
import { type AccountHistory, storedOn, typeOn, valueOn } from "./series";
import type { RatePick } from "./valuation";

const at = (day: string, time = "00:00") => new Date(`${day}T${time}:00.000Z`);
const ars = (major: number) => Math.round(major * 100);

function pickWith(arsBlueOn: (day: string) => number): RatePick {
	return (currency, date, preferred) => {
		if (currency !== "ARS") return null;
		const day = date.toISOString().slice(0, 10);
		const types: Record<string, number> = {
			blue: arsBlueOn(day),
			official: 1412,
			mep: 1449,
		};
		const type = preferred && types[preferred] ? preferred : "blue";
		return { rate: types[type] ?? 0, type, date, onOrBefore: true };
	};
}
const pick = pickWith(() => 1468);

let n = 0;
function account(
	opts: {
		type?: AssetType;
		currency?: string;
		rateType?: string | null;
		closedAt?: Date | null;
		checkpoints?: [string, string, string?][];
		legs?: [string, string, AccountLegSource, number | null, string?][];
		rateTypes?: [string, string | null][];
	} = {},
): AccountHistory {
	const currency = opts.currency ?? "ARS";
	return {
		account: {
			id: `a${++n}`,
			type: opts.type ?? "CASH",
			currency,
			exchangeRateType: opts.rateType ?? null,
			exchangeRate: null,
			closedAt: opts.closedAt ?? null,
		},
		checkpoints: (opts.checkpoints ?? []).map(([day, balance, time]) => ({
			date: at(day),
			recordedAt: at(day, time ?? "12:00"),
			balance: dec(balance),
			currency,
			exchangeRateType: opts.rateType ?? null,
		})),
		legs: (opts.legs ?? []).map(([day, amount, source, home, created]) => ({
			id: `g${++n}`,
			date: at(day),
			createdAt: created ? new Date(created) : at(day, "13:00"),
			amount: dec(amount),
			source,
			homeAmount: home === null ? null : dec(home),
			homeCurrency: home === null ? null : "ARS",
		})),
		rateTypes: (opts.rateTypes ?? []).map(([day, type], i, all) => ({
			from: at(day),
			type,
			previousType:
				i === 0 ? (opts.rateType ?? null) : (all[i - 1]?.[1] ?? null),
		})),
	};
}

const SPAN = { from: "2026-10-01", to: "2026-10-21" };

function change(
	histories: AccountHistory[],
	notTracked: NotTrackedHistory[] = [],
	p: RatePick = pick,
) {
	const result = netWorthChange(histories, notTracked, SPAN, "ARS", p);
	if (!result) throw new Error("unavailable");
	const sum = CHANGE_PARTS.reduce((t, k) => t + result.parts[k], 0);
	expect(sum, "the parts add up to the change").toBe(result.total);
	return result;
}

describe("account balance on a day", () => {
	it("a payment into a card lowers what you owe", () => {
		const card = account({
			type: "LIABILITY_CREDIT_CARD",
			checkpoints: [["2026-09-01", "842600"]],
			legs: [["2026-10-10", "842600", "TRANSFER", 842600]],
		});
		expect(storedOn(card, "2026-10-09")?.toString()).toBe("842600");
		expect(storedOn(card, "2026-10-10")?.toString()).toBe("0");
	});

	it("a move recorded after a balance update still counts from its own date", () => {
		const wallet = account({
			checkpoints: [
				["2026-09-01", "1000000"],
				["2026-10-10", "987700"],
			],
			legs: [
				[
					"2026-10-05",
					"-100000",
					"TRANSFER",
					-100000,
					"2026-10-20T09:00:00.000Z",
				],
			],
		});
		expect(storedOn(wallet, "2026-10-07")?.toString()).toBe("900000");
		expect(storedOn(wallet, "2026-10-21")?.toString()).toBe("887700");
	});

	it("a balance update's own leg never adds on top of it", () => {
		const wallet = account({
			checkpoints: [
				["2026-09-01", "1000000"],
				["2026-10-10", "987700", "12:00"],
			],
			legs: [
				[
					"2026-10-10",
					"-12300",
					"BALANCE_UPDATE",
					-12300,
					"2026-10-10T12:00:00.000Z",
				],
			],
		});
		expect(storedOn(wallet, "2026-10-21")?.toString()).toBe("987700");
	});

	it("a rate type switch applies from its day; earlier days keep theirs (D3)", () => {
		const usd = account({
			currency: "USD",
			rateType: "official",
			checkpoints: [["2026-09-01", "2000"]],
			rateTypes: [["2026-10-15", "blue"]],
		});
		expect(typeOn(usd, "2026-10-14").rateType).toBe("official");
		expect(typeOn(usd, "2026-10-15").rateType).toBe("blue");
		expect(valueOn(usd, "2026-10-14", "ARS", pick)?.toString()).toBe("2824000");
		expect(valueOn(usd, "2026-10-15", "ARS", pick)?.toString()).toBe("2936000");
	});

	it("before the first switch an old balance keeps the type the switch replaced, not today's", () => {
		const legacy = account({
			currency: "USD",
			rateType: "official",
			checkpoints: [["2026-09-01", "2000"]],
			rateTypes: [["2026-10-15", "blue"]],
		});
		// Today's type is the switch's; the old snapshot recorded no type.
		const today = {
			...legacy,
			account: { ...legacy.account, exchangeRateType: "blue" },
			checkpoints: legacy.checkpoints.map((c) => ({ ...c, currency: null })),
		};
		expect(typeOn(today, "2026-10-14").rateType).toBe("official");
		expect(valueOn(today, "2026-10-14", "ARS", pick)?.toString()).toBe(
			"2824000",
		);
	});
});

describe("netWorthChange breakdown (I10)", () => {
	it("income kept in Wise at MEP, valued at Official: income +2,898,000, revaluation -74,000 (Example G)", () => {
		const wise = account({
			currency: "USD",
			rateType: "official",
			checkpoints: [["2026-09-01", "1840.55"]],
			legs: [["2026-10-14", "2000", "INCOME", 2898000]],
		});
		const result = change([wise]);
		expect(result.total).toBe(ars(2_824_000));
		expect(result.parts.income).toBe(ars(2_898_000));
		expect(result.parts.revaluation).toBe(ars(-74_000));
	});

	it("buying USD 300 for ARS 442,500 is an exchange cost of 2,100 (§2.4)", () => {
		const wallet = account({
			rateType: "blue",
			checkpoints: [["2026-09-01", "1000000"]],
			legs: [["2026-10-15", "-442500", "TRANSFER", -442500]],
		});
		const usdCash = account({
			currency: "USD",
			rateType: "blue",
			checkpoints: [["2026-09-01", "0"]],
			legs: [["2026-10-15", "300", "TRANSFER", 440400]],
		});
		const result = change([wallet, usdCash]);
		expect(result.total).toBe(ars(-2_100));
		expect(result.parts.exchange).toBe(ars(-2_100));
		expect(result.parts.revaluation).toBe(0);
	});

	it("a balance update shows its difference as Not logged", () => {
		const wallet = account({
			checkpoints: [
				["2026-09-01", "1000000"],
				["2026-10-10", "987700"],
			],
			legs: [
				[
					"2026-10-10",
					"-12300",
					"BALANCE_UPDATE",
					-12300,
					"2026-10-10T12:00:00.000Z",
				],
			],
		});
		const result = change([wallet]);
		expect(result.total).toBe(ars(-12_300));
		expect(result.parts.notLogged).toBe(ars(-12_300));
	});

	it("a late-recorded move is its own part, not Not logged", () => {
		const wallet = account({
			checkpoints: [
				["2026-09-01", "1000000"],
				["2026-10-10", "987700"],
			],
			legs: [
				[
					"2026-10-05",
					"-100000",
					"TRANSFER",
					-100000,
					"2026-10-20T09:00:00.000Z",
				],
			],
		});
		const result = change([wallet]);
		expect(result.total).toBe(ars(-112_300));
		expect(result.parts.notLogged).toBe(ars(-12_300));
		expect(result.parts.exchange).toBe(ars(-100_000));
	});

	it("a rate type switch is a revaluation on its day (D3)", () => {
		const usd = account({
			currency: "USD",
			rateType: "official",
			checkpoints: [["2026-09-01", "2000"]],
			rateTypes: [["2026-10-15", "blue"]],
		});
		expect(change([usd]).parts.revaluation).toBe(ars(112_000));
	});

	it("rates moving is a revaluation", () => {
		const usd = account({
			currency: "USD",
			checkpoints: [["2026-09-01", "1000"]],
		});
		const moving = pickWith((day) => (day <= "2026-10-10" ? 1400 : 1468));
		const result = change([usd], [], moving);
		expect(result.total).toBe(ars(68_000));
		expect(result.parts.revaluation).toBe(ars(68_000));
	});

	it("an account added in the span is opened, one closed in it is closed", () => {
		const added = account({ checkpoints: [["2026-10-05", "50000"]] });
		const gone = account({
			closedAt: at("2026-10-12", "15:00"),
			checkpoints: [
				["2026-09-01", "30000"],
				["2026-10-12", "0"],
			],
		});
		const result = change([added, gone]);
		expect(result.parts.opened).toBe(ars(50_000));
		expect(result.parts.closed).toBe(ars(-30_000));
		expect(result.total).toBe(ars(20_000));
	});

	it("a withdrawal into Not tracked cash moves nothing (§2.7)", () => {
		const wallet = account({
			checkpoints: [["2026-09-01", "1000000"]],
			legs: [["2026-10-15", "-100000", "TRANSFER", -100000]],
		});
		const cash: NotTrackedHistory = {
			currency: "ARS",
			legs: [
				{
					id: "nt1",
					date: at("2026-10-15"),
					createdAt: at("2026-10-15", "13:00"),
					amount: dec("100000"),
					source: "TRANSFER",
					homeAmount: dec("100000"),
					homeCurrency: "ARS",
				},
			],
		};
		const result = change([wallet], [cash]);
		expect(result.total).toBe(0);
		expect(result.parts.exchange).toBe(0);
	});

	it("a missing rate makes the breakdown unavailable, never a guess", () => {
		const clp = account({
			currency: "CLP",
			checkpoints: [["2026-09-01", "1000"]],
		});
		expect(netWorthChange([clp], [], SPAN, "ARS", pick)).toBeNull();
	});
});

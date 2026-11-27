/**
 * The local version moves exactly as the database trigger does: by 1 when a
 * device-editable column changes value, never for the balance, the counted
 * units, the name, the icon or a refreshed table rate.
 */
import {
	ACCOUNT_VERSION_COLUMNS,
	ACCOUNT_VERSION_SKIPPED,
	type AccountVersionColumn,
} from "@retrospend/domain/accounts/version-columns";
import { describe, expect, it } from "vitest";
import { seedRowOf } from "./account-conformance";
import { movesVersion, withLocalVersion } from "./account-version";
import type { AccountRow } from "./accounts";

const base: AccountRow = {
	...seedRowOf({
		id: "a1",
		name: "Wise",
		type: "CASH",
		currency: "USD",
		balance: "100",
		exchangeRate: "1",
		exchangeRateType: "blue",
	}),
	interestRate: "24.5",
	minimumPayment: "10",
	dueDate: 5,
	inBudget: false,
	version: 7,
};

/** One change per versioned column. The Record fails to compile when the constant gains a column. */
const CHANGES: Record<AccountVersionColumn, Partial<AccountRow>> = {
	type: { type: "INVESTMENT" },
	currency: { currency: "ARS" },
	exchangeRateType: { exchangeRateType: "official" },
	closedAt: { closedAt: new Date("2026-11-10T00:00:00Z") },
	inBudget: { inBudget: true },
	isLiquid: { isLiquid: false },
	interestRate: { interestRate: "25" },
	minimumPayment: { minimumPayment: "11" },
	dueDate: { dueDate: 6 },
};

describe("movesVersion", () => {
	it.each(ACCOUNT_VERSION_COLUMNS)("moves when %s changes", (column) => {
		expect(movesVersion(base, { ...base, ...CHANGES[column] })).toBe(true);
	});

	it("moves when a null becomes a value and back", () => {
		const none = { ...base, interestRate: null, inBudget: null };
		expect(movesVersion(none, { ...none, interestRate: "1" })).toBe(true);
		expect(movesVersion(none, { ...none, inBudget: false })).toBe(true);
		expect(movesVersion({ ...none, interestRate: "1" }, none)).toBe(true);
	});

	it("does not move for what the trigger skips", () => {
		expect(Object.keys(ACCOUNT_VERSION_SKIPPED)).toContain("balance");
		for (const change of [
			{ balance: "5000" },
			{ countedUnits: "3" },
			{ name: "Renamed" },
			{ iconKind: "BRAND" },
			// A table rate refreshed by a checkpoint is a cache, not an edit.
			{ exchangeRate: "1500" },
		])
			expect(movesVersion(base, { ...base, ...change })).toBe(false);
	});

	it("compares decimals by value, not by text", () => {
		expect(
			movesVersion(base, {
				...base,
				interestRate: "24.500000",
				minimumPayment: "10.00000000",
			}),
		).toBe(false);
	});

	it("compares an instant by time", () => {
		const closed = { ...base, closedAt: new Date("2026-11-10T00:00:00Z") };
		expect(
			movesVersion(closed, {
				...closed,
				closedAt: new Date("2026-11-10T00:00:00Z"),
			}),
		).toBe(false);
	});

	it("counts the typed rate only while the rate type is custom", () => {
		const custom = {
			...base,
			exchangeRateType: "custom",
			exchangeRate: "1412.5",
		};
		expect(movesVersion(custom, { ...custom, exchangeRate: "1413" })).toBe(
			true,
		);
		expect(
			movesVersion(custom, { ...custom, exchangeRate: "1412.500000" }),
		).toBe(false);
		// The new type decides: leaving custom with another stored rate is the type's change, nothing more.
		expect(
			movesVersion(custom, {
				...custom,
				exchangeRateType: "blue",
				exchangeRate: "1500",
			}),
		).toBe(true);
		const table = { ...base, exchangeRateType: "blue", exchangeRate: "1545" };
		expect(movesVersion(table, { ...table, exchangeRate: "1550" })).toBe(false);
	});
});

describe("withLocalVersion", () => {
	it("adds 1 once for a write that changes several columns", () => {
		expect(
			withLocalVersion(base, {
				...base,
				isLiquid: false,
				inBudget: true,
				dueDate: 9,
			}).version,
		).toBe(8);
	});

	it("keeps the version otherwise", () => {
		expect(withLocalVersion(base, { ...base, balance: "1" }).version).toBe(7);
	});

	it("starts from the row it replaces, never the version of the row it is given", () => {
		expect(
			withLocalVersion(base, { ...base, version: 99, isLiquid: false }).version,
		).toBe(8);
		expect(withLocalVersion(base, { ...base, version: 99 }).version).toBe(7);
	});
});

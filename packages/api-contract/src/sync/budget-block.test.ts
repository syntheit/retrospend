import { describe, expect, it } from "vitest";
import { syncBudgetBlockSchema } from "./budget-block";

/**
 * The device refuses a budget block that is corrupt, so the contract must too:
 * a block that parses here is one the device keeps. One valid block, then one
 * fault at a time. The block is a copy of the one the engine test builds, as
 * the contract cannot import the engine.
 */

const base = {
	counterparty: "p1",
	currency: "USD",
	date: "2026-03-05",
	month: 202603,
	native: 1000,
};

const valid = () => ({
	bookId: "book-1",
	valuationKey: "ARS|America/Argentina/Buenos_Aires|2026-03-01|202603:5:blue",
	asOf: "cursor-1",
	frozen: [
		{
			key: "e1|ARS|1000|0.67|2026-03-05|blue",
			minor: 100_000,
			approximate: false,
		},
		{
			key: "e2|USD|10|10|2026-03-06|blue",
			minor: 1_500_000,
			approximate: true,
		},
	],
	splits: {
		shares: [
			{
				id: "part-1",
				month: 202603,
				date: "2026-03-06",
				minor: -75_000,
				source: "SHARE",
				categoryId: "c1",
				envelopeId: null,
				pending: true,
			},
		],
		effects: [
			{
				eventId: "e1",
				date: "2026-03-05",
				month: 202603,
				counterparty: "p1",
				currency: "USD",
				term: "FRONTED",
				minor: 150_000,
				fx: 0,
				envelopeId: null,
			},
		],
		balances: [
			{
				counterparty: "p1",
				currency: "USD",
				native: 1000,
				basis: 150_000,
				oldestOpen: "2026-03-05",
			},
			{
				counterparty: "p2",
				currency: "USD",
				native: -500,
				basis: 0,
				oldestOpen: null,
			},
		],
		ignored: [{ eventId: "e9", reason: "NOT_IN_BUDGET", native: 700 }],
		events: [
			{
				...base,
				id: "e1",
				kind: "FRONT",
				value: 150_000,
				shareStatus: "ACCEPTED",
			},
			{ ...base, id: "e2", kind: "OWE", status: "ACCEPTED" },
			{ ...base, id: "e3", kind: "UNFRONT" },
			{
				...base,
				id: "e4",
				kind: "RECV",
				status: "FINALIZED",
				cash: 160_000,
				isOffset: false,
			},
			{
				...base,
				id: "e5",
				kind: "PAY",
				status: "PROPOSED",
				cash: 20_000,
				forgiven: true,
			},
			{
				...base,
				id: "e6",
				kind: "FORGIVE",
				status: "FINALIZED",
				envelopeId: "env-1",
				notInBudget: true,
			},
		],
		pending: [
			{
				id: "e7",
				counterparty: "p1",
				currency: "USD",
				native: 500,
				cash: null,
				date: "2026-03-09",
			},
			{
				id: "e8",
				counterparty: "p1",
				currency: "USD",
				native: 500,
				cash: 75_000,
				date: "2026-03-09",
			},
		],
		unresolved: ["share-9"],
		notInBudget: ["project-1"],
		missingRates: [
			{ currency: "XQZ", rateType: null, date: "2026-03-05", rowId: "e1" },
		],
		approximate: [{ rowId: "e2", date: "2026-03-05" }],
		checkpointMissingRates: [
			{ currency: "XQZ", rateType: "blue", date: "2026-02-05" },
		],
		checkpointApproximate: [{ rowId: "e3", date: "2026-02-05" }],
		planCheckpointMissingRates: [
			{ currency: "XQZ", rateType: "blue", date: "2026-03-01", rowId: "e4" },
		],
		planCheckpointApproximate: [{ rowId: "e5", date: "2026-03-01" }],
	},
});

const REMOVE = Symbol("remove");
type Fault = readonly [string, readonly (string | number)[], unknown];

/** Each fault is one the device check (the engine's budget-block-check) refuses. */
const FAULTS: readonly Fault[] = [
	["an asOf that is a number", ["asOf"], 5],
	["an empty asOf", ["asOf"], ""],
	["no asOf", ["asOf"], REMOVE],
	["an empty book id", ["bookId"], ""],
	["a book id that is a number", ["bookId"], 7],
	["a valuation key that is a number", ["valuationKey"], 1],
	["frozen that is not a list", ["frozen"], {}],
	["a frozen key that is a number", ["frozen", 0, "key"], 1],
	["a frozen approximate that is text", ["frozen", 0, "approximate"], "no"],
	[
		"a repeated frozen key",
		["frozen", 1, "key"],
		"e1|ARS|1000|0.67|2026-03-05|blue",
	],
	["a fractional frozen value", ["frozen", 0, "minor"], 1.5],
	["a frozen value past the safe integers", ["frozen", 0, "minor"], 2 ** 53],
	["splits that are not an object", ["splits"], "none"],
	["a splits list that is missing", ["splits", "balances"], REMOVE],
	["a fractional split share", ["splits", "shares", 0, "minor"], -0.5],
	[
		"a split share on a date that does not exist",
		["splits", "shares", 0, "date"],
		"2026-02-30",
	],
	["a split share in month 13", ["splits", "shares", 0, "month"], 202613],
	["a split share id that is a number", ["splits", "shares", 0, "id"], 4],
	[
		"a split share envelope that is a number",
		["splits", "shares", 0, "envelopeId"],
		4,
	],
	["a fractional effect fx", ["splits", "effects", 0, "fx"], 0.5],
	["an effect on a bad date", ["splits", "effects", 0, "date"], "x"],
	["an effect minor that is text", ["splits", "effects", 0, "minor"], "150000"],
	[
		"a balance past the safe integers",
		["splits", "balances", 0, "native"],
		1e21,
	],
	["a fractional balance basis", ["splits", "balances", 0, "basis"], 1.5],
	[
		"a balance oldest open that is not a date",
		["splits", "balances", 0, "oldestOpen"],
		"March",
	],
	["a fractional ignored amount", ["splits", "ignored", 0, "native"], 0.1],
	["an event of no known kind", ["splits", "events", 0, "kind"], "WAT"],
	["a fractional FRONT value", ["splits", "events", 0, "value"], 1.5],
	["a RECV cash that is text", ["splits", "events", 3, "cash"], "5"],
	[
		"a PAY cash past the safe integers",
		["splits", "events", 4, "cash"],
		2 ** 53,
	],
	[
		"a FORGIVE envelope that is a number",
		["splits", "events", 5, "envelopeId"],
		1,
	],
	["a fractional event native", ["splits", "events", 1, "native"], 0.5],
	["an event in month zero", ["splits", "events", 1, "month"], 0],
	["an event on a bad date", ["splits", "events", 2, "date"], "2026-13-01"],
	[
		"an event notInBudget that is text",
		["splits", "events", 5, "notInBudget"],
		"yes",
	],
	["a fractional pending cash", ["splits", "pending", 1, "cash"], 1.5],
	[
		"a pending receipt on a bad date",
		["splits", "pending", 0, "date"],
		"9 March",
	],
	["a missing rate on a bad date", ["splits", "missingRates", 0, "date"], "x"],
	[
		"a missing rate currency that is a number",
		["splits", "missingRates", 0, "currency"],
		1,
	],
	[
		"an approximate row id that is a number",
		["splits", "approximate", 0, "rowId"],
		2,
	],
	[
		"a checkpoint missing rate on a bad date",
		["splits", "checkpointMissingRates", 0, "date"],
		"x",
	],
	[
		"a checkpoint approximate row on a date that does not exist",
		["splits", "checkpointApproximate", 0, "date"],
		"2026-02-31",
	],
	[
		"a plan checkpoint missing rate on a bad date",
		["splits", "planCheckpointMissingRates", 0, "date"],
		"x",
	],
	[
		"a plan checkpoint approximate row on a date that does not exist",
		["splits", "planCheckpointApproximate", 0, "date"],
		"2026-02-31",
	],
	["an unresolved id that is a number", ["splits", "unresolved", 0], 3],
	["a not-in-budget project that is a number", ["splits", "notInBudget", 0], 3],
];

function poke(
	doc: unknown,
	path: readonly (string | number)[],
	value: unknown,
) {
	let at = doc as Record<string | number, unknown>;
	for (const key of path.slice(0, -1))
		at = at[key] as Record<string | number, unknown>;
	const last = path[path.length - 1] as string | number;
	if (value === REMOVE) delete at[last];
	else at[last] = value;
}

describe("syncBudgetBlockSchema", () => {
	it("parses a block with something in every list, one event of each kind", () => {
		expect(syncBudgetBlockSchema.safeParse(valid()).success).toBe(true);
	});

	it("accepts the last day of a leap February and refuses it in a common year", () => {
		const leap = valid();
		poke(leap, ["splits", "shares", 0, "date"], "2028-02-29");
		expect(syncBudgetBlockSchema.safeParse(leap).success).toBe(true);
		const common = valid();
		poke(common, ["splits", "shares", 0, "date"], "2026-02-29");
		expect(syncBudgetBlockSchema.safeParse(common).success).toBe(false);
	});

	for (const [name, path, value] of FAULTS)
		it(`refuses a block with ${name}`, () => {
			const bad = valid();
			poke(bad, path, value);
			expect(syncBudgetBlockSchema.safeParse(bad).success).toBe(false);
		});
});

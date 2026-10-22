import { describe, expect, it } from "vitest";
import en from "@retrospend/i18n/messages/en.json";
import {
	claimConflictAction,
	oppositeCurrencyBalances,
	type SettlementEntryView,
	settlementDetail,
	settlementProjectParts,
} from "./settlement-display";

const format = (amount: number, currency: string) =>
	`${currency} ${amount.toFixed(2)}`;

/** Fills the English `people` messages, like next-intl does. */
const t = (key: string, values: Record<string, string | number> = {}) => {
	const template = (en.people as Record<string, string>)[key];
	if (!template) throw new Error(`missing people.${key}`);
	return template.replace(/\{(\w+)\}/g, (_, name: string) =>
		String(values[name] ?? `{${name}}`),
	);
};

/** alice (the viewer) paid 20 into Trip and offset 30 Trip against Rent. */
const offsetPayment: SettlementEntryView = {
	kind: "payment",
	amount: 20,
	currency: "USD",
	cashByCurrency: [{ currency: "USD", amount: 20 }],
	offsetByCurrency: [{ currency: "USD", amount: 30 }],
	parts: [
		{ projectId: "trip", projectName: "Trip", currency: "USD", amount: 20, isOffset: false, direction: "outgoing" },
		{ projectId: "trip", projectName: "Trip", currency: "USD", amount: 30, isOffset: true, direction: "outgoing" },
		{ projectId: "rent", projectName: "Rent", currency: "USD", amount: 30, isOffset: true, direction: "incoming" },
	],
};

const splitPayment: SettlementEntryView = {
	kind: "payment",
	amount: 100,
	currency: "USD",
	cashByCurrency: [{ currency: "USD", amount: 100 }],
	offsetByCurrency: [],
	parts: [
		{ projectId: "trip", projectName: "Trip", currency: "USD", amount: 60, isOffset: false, direction: "outgoing" },
		{ projectId: null, projectName: null, currency: "USD", amount: 40, isOffset: false, direction: "outgoing" },
	],
};

describe("settlementDetail", () => {
	it("shows the cash and the offset of a full settle-up", () => {
		expect(settlementDetail(offsetPayment, format, t)).toBe(
			"Paid USD 20.00, offset USD 30.00: Trip against Rent",
		);
	});

	it("shows a square-up without cash", () => {
		expect(
			settlementDetail(
				{
					...offsetPayment,
					kind: "square_up",
					cashByCurrency: [],
					parts: offsetPayment.parts.filter((p) => p.isOffset),
				},
				format,
				t,
			),
		).toBe("Offset USD 30.00: Trip against Rent");
	});

	it("breaks a payment down per project", () => {
		expect(settlementDetail(splitPayment, format, t)).toBe(
			"Trip USD 60.00 · Standalone USD 40.00",
		);
	});

	it("says nothing extra for a payment in one scope", () => {
		expect(
			settlementDetail(
				{ ...splitPayment, parts: [splitPayment.parts[0]!] },
				format,
				t,
			),
		).toBeNull();
	});
});

describe("settlementProjectParts", () => {
	it("labels a project's part of a larger payment", () => {
		expect(settlementProjectParts(splitPayment, "trip", format, t)).toEqual([
			{
				amount: 60,
				currency: "USD",
				direction: "outgoing",
				detail: "USD 60.00 of a USD 100.00 payment",
			},
		]);
	});

	it("nets cash and offsets in a project and says what was offset", () => {
		expect(settlementProjectParts(offsetPayment, "trip", format, t)).toEqual([
			{
				amount: 50,
				currency: "USD",
				direction: "outgoing",
				detail: "USD 30.00 offset against another project",
			},
		]);
		expect(settlementProjectParts(offsetPayment, "rent", format, t)).toEqual([
			{
				amount: 30,
				currency: "USD",
				direction: "incoming",
				detail: "USD 30.00 offset against another project",
			},
		]);
	});

	it("skips payments without a part in the project", () => {
		expect(settlementProjectParts(splitPayment, "rent", format, t)).toEqual([]);
	});
});

describe("oppositeCurrencyBalances", () => {
	const plans = [
		{ currency: "USD", direction: "you_owe_them", balance: 20 },
		{ currency: "ARS", direction: "they_owe_you", balance: 30000 },
		{ currency: "EUR", direction: "you_owe_them", balance: 5 },
	];

	it("lists the other currencies going the other way", () => {
		expect(oppositeCurrencyBalances(plans, plans[0]!)).toEqual([plans[1]]);
		expect(oppositeCurrencyBalances(plans, plans[1]!)).toEqual([
			plans[0],
			plans[2],
		]);
	});

	it("is empty when every currency goes the same way", () => {
		expect(oppositeCurrencyBalances([plans[0]!, plans[2]!], plans[0]!)).toEqual(
			[],
		);
	});

	it("the English hint reads as one sentence", () => {
		const hint = (en.settleUp as Record<string, string>).alsoTheyOwe!
			.replace("{name}", "Bob")
			.replace("{amounts}", "ARS 30,000.00");
		expect(hint).toBe(
			"Bob also owes you ARS 30,000.00. Each currency is settled separately.",
		);
	});
});

describe("claimConflictAction", () => {
	it("offers the retry only for a claim conflict", () => {
		const retry = () => {};
		expect(claimConflictAction({ data: { code: "CONFLICT" } }, "Record", retry)).toEqual({
			action: { label: "Record", onClick: retry },
		});
		expect(claimConflictAction({ data: { code: "BAD_REQUEST" } }, "Record", retry)).toBeUndefined();
		expect(claimConflictAction({}, "Record", retry)).toBeUndefined();
	});
});

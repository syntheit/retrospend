import { channelsOn } from "./channels";
import type { NotificationPreference } from "./source";

// The contract package is ESM source jest does not transform: its two lists,
// as the contract writes them (RECURRING_DUE is only a push).
jest.mock("@retrospend/api-contract", () => ({
	INBOX_NOTIFICATION_TYPES: ["EXPENSE_SPLIT", "PAYMENT_REMINDER"],
	PUSH_NOTIFICATION_TYPES: [
		"EXPENSE_SPLIT",
		"PAYMENT_REMINDER",
		"RECURRING_DUE",
	],
}));

const prefs: NotificationPreference[] = [
	{
		type: "EXPENSE_SPLIT",
		inApp: true,
		push: true,
		email: false,
		digestMode: false,
	},
	{
		type: "PAYMENT_REMINDER",
		inApp: true,
		push: false,
		email: true,
		digestMode: true,
	},
];

describe("channelsOn", () => {
	it("lists the channels that are on, in the sheet's order", () => {
		expect(channelsOn(prefs[0] as NotificationPreference, true)).toEqual([
			"inApp",
			"push",
		]);
		expect(channelsOn(prefs[1] as NotificationPreference, true)).toEqual([
			"inApp",
			"email",
		]);
	});

	it("leaves push out while the phone has none", () => {
		expect(channelsOn(prefs[0] as NotificationPreference, false)).toEqual([
			"inApp",
		]);
	});

	it("ignores channels a type does not have", () => {
		const due: NotificationPreference = {
			type: "RECURRING_DUE",
			inApp: true,
			push: true,
			email: true,
			digestMode: false,
		};
		expect(channelsOn(due, true)).toEqual(["push"]);
	});
});

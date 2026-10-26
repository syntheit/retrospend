import {
	NOTIFICATION_TYPES as CONTRACT_TYPES,
	PUSH_NOTIFICATION_TYPES,
} from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import {
	channelsOf,
	DEFAULT_PREF,
	flip,
	NOTIFICATION_TYPES,
	samePref,
} from "../notifications/prefs";

describe("notification switches", () => {
	const on = { inApp: true, push: true, email: true, digestMode: true };

	it("flips one channel", () => {
		expect(flip(DEFAULT_PREF, "email", true)).toEqual({
			inApp: true,
			push: true,
			email: true,
			digestMode: false,
		});
		expect(flip(on, "inApp", false)).toEqual({ ...on, inApp: false });
	});

	it("keeps push apart from the in-app switch", () => {
		expect(flip(on, "push", false)).toEqual({ ...on, push: false });
		expect(flip(on, "inApp", false).push).toBe(true);
	});

	it("turns the digest off with Email", () => {
		expect(flip(on, "email", false)).toEqual({
			inApp: true,
			push: true,
			email: false,
			digestMode: false,
		});
	});

	it("does not turn the digest on without Email", () => {
		expect(flip(DEFAULT_PREF, "digestMode", true)).toEqual(DEFAULT_PREF);
	});

	it("compares preferences by value", () => {
		expect(samePref(on, { ...on })).toBe(true);
		expect(samePref(on, DEFAULT_PREF)).toBe(false);
		expect(samePref(on, { ...on, push: false })).toBe(false);
	});
});

describe("which switches a type has", () => {
	it("lists every type the API has", () => {
		expect([...NOTIFICATION_TYPES].sort()).toEqual([...CONTRACT_TYPES].sort());
	});

	it("offers push only where there is a push, and only push for recurring items", () => {
		expect(channelsOf("EXPENSE_SPLIT")).toEqual([
			"inApp",
			"push",
			"email",
			"digestMode",
		]);
		expect(channelsOf("EXPENSE_DELETED")).toEqual([
			"inApp",
			"email",
			"digestMode",
		]);
		expect(channelsOf("RECURRING_DUE")).toEqual(["push"]);
		for (const type of NOTIFICATION_TYPES)
			expect(channelsOf(type).includes("push")).toBe(
				PUSH_NOTIFICATION_TYPES.includes(type),
			);
	});
});

import { MAX_SECRET_GRACE_SECONDS } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import en from "../../../../packages/i18n/messages/en/settingsV2.json";
import {
	editPatch,
	GRACE_CHOICES,
	graceKey,
	undoPatch,
} from "../developer/webhooks";

const hook = {
	name: "Home server",
	url: "https://home.example.com/hook?token=abc",
	eventTypes: ["expense.*", "payment.*"],
	enabled: true,
};

describe("the grace choices of Rotate secret", () => {
	it("starts at once (the safe default) and never goes past what the API accepts", () => {
		expect(GRACE_CHOICES[0]).toBe(0);
		expect(Math.max(...GRACE_CHOICES)).toBeLessThanOrEqual(
			MAX_SECRET_GRACE_SECONDS,
		);
		// Segmented holds two to four options.
		expect(GRACE_CHOICES.length).toBeGreaterThanOrEqual(2);
		expect(GRACE_CHOICES.length).toBeLessThanOrEqual(4);
	});

	it("has a word for each choice in the English catalog", () => {
		const rotate = en.developer.rotate as {
			grace: Record<string, string>;
			graceHint: Record<string, string>;
		};
		for (const seconds of GRACE_CHOICES) {
			expect(rotate.grace[graceKey(seconds)], String(seconds)).toBeTruthy();
			expect(rotate.graceHint[graceKey(seconds)], String(seconds)).toBeTruthy();
		}
	});
});

describe("editing a webhook", () => {
	it("sends nothing for an edit that changed nothing", () => {
		expect(
			editPatch(hook, { ...hook, eventTypes: [...hook.eventTypes] }),
		).toEqual({});
	});

	it("sends only the fields that differ; the URL is trimmed, the name is sent as typed", () => {
		expect(
			editPatch(hook, {
				...hook,
				name: "  Home server 2 ",
				url: " https://home.example.com/other ",
			}),
		).toEqual({
			name: "  Home server 2 ",
			url: "https://home.example.com/other",
		});
		// A name is user text (opaque): spaces alone are a change, and are kept.
		expect(editPatch(hook, { ...hook, name: "Home server " })).toEqual({
			name: "Home server ",
		});
		expect(editPatch(hook, { ...hook, enabled: false })).toEqual({
			enabled: false,
		});
	});

	it("reads the same events in another order as unchanged", () => {
		expect(
			editPatch(hook, { ...hook, eventTypes: ["payment.*", "expense.*"] }),
		).toEqual({});
		expect(editPatch(hook, { ...hook, eventTypes: [] })).toEqual({
			eventTypes: [],
		});
	});

	it("puts back why a webhook was off when the edit turned it on", () => {
		const off = {
			...hook,
			enabled: false,
			disabledReason: "too_many_failures" as const,
			disabledAt: "2026-10-26T10:00:00.000Z",
		};
		expect(undoPatch(off, { enabled: true })).toEqual({
			enabled: false,
			disabledReason: "too_many_failures",
			disabledAt: "2026-10-26T10:00:00.000Z",
		});
		// Turning one off needs no reason: the owner chose it.
		expect(undoPatch(hook, { enabled: false })).toEqual({ enabled: true });
	});

	it("undoes an edit with the values it replaced", () => {
		const patch = editPatch(hook, {
			name: "Other",
			url: hook.url,
			eventTypes: ["income.*"],
			enabled: false,
		});
		expect(undoPatch(hook, patch)).toEqual({
			name: "Home server",
			eventTypes: ["expense.*", "payment.*"],
			enabled: true,
		});
	});
});

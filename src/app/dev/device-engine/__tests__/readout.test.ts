import type { CompareReport, ScreenName } from "@retrospend/engine/device";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../packages/i18n/messages/en/deviceEngine.json";

const controller = vi.hoisted(() => ({
	reports: {} as unknown,
	lastPullAt: null as number | null,
	subscribe: vi.fn(() => () => undefined),
	checkNow: vi.fn(async () => undefined),
}));
const instance = vi.hoisted(() => ({ deviceController: vi.fn() }));
vi.mock("~/lib/device-engine/instance", () => ({
	deviceController: instance.deviceController,
}));
vi.mock("~/lib/device-engine/react", () => ({
	DeviceEngineLifecycle: () => null,
}));

import { DeviceEngineReadout } from "../readout";
import { CompareView } from "../view";

const render = (element: ReactElement) =>
	renderToStaticMarkup(
		createElement(
			NextIntlClientProvider,
			{
				locale: "en",
				timeZone: "UTC",
				messages: { deviceEngine: en },
			} as unknown as Parameters<typeof NextIntlClientProvider>[0],
			element,
		),
	);

// A report as the worker makes it, plus fields a careless change could add:
// the lines of each side, with amounts. The page reads only ids, counts, words.
const report = (over: Partial<CompareReport> = {}) =>
	({
		screen: "home",
		state: "checked",
		skipped: null,
		keys: 5,
		of: 5,
		differs: ["glance.spentLast"],
		behind: 1,
		ratesMoved: 0,
		generation: 3,
		zone: "differs",
		clock: "2026-11-18T12:00:00.000Z",
		classes: { "glance.spentLast": "differs" },
		verdictParts: [],
		lines: [{ minor: 987654321, currency: "ARS" }],
		device: [{ minor: 424242424 }],
		server: [{ minor: 515151515 }],
		...over,
	}) as unknown as CompareReport;

const view = (
	reports: Partial<Record<ScreenName, CompareReport>>,
	phase: "running" | "off" = "running",
) => render(createElement(CompareView, { reports, lastPullAt: null, phase }));

describe("the readout's view", () => {
	it("lists each screen's last report in words and counts, never an amount", () => {
		const html = view({
			home: report(),
			budget: report({
				screen: "budget",
				differs: [],
				keys: 14,
				of: 40,
				behind: 0,
			}),
		});
		expect(html).toContain("home");
		expect(html).toContain("budget");
		expect(html).toContain("Differs from the server");
		expect(html).toContain("Matches the server");
		expect(html).toContain("glance.spentLast");
		expect(html).toContain("5 of 5");
		expect(html).toContain("14 of 40");
		for (const minor of ["987654321", "424242424", "515151515"])
			expect(html).not.toContain(minor);
		expect(html).not.toContain("ARS");
	});

	it("names a skipped check and its reason", () => {
		const html = view({
			wealth: report({
				screen: "wealth",
				state: "skipped",
				skipped: "settings_differ",
				differs: [],
			}),
		});
		expect(html).toContain("Nothing to check yet");
		expect(html).toContain("settings_differ");
	});

	it("says no check has run yet when there is no report", () => {
		expect(view({}, "off")).toContain("No check has run yet");
	});
});

describe("the readout page body", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		instance.deviceController.mockReset();
	});

	it("without the dev flag says so and never touches the controller", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "");
		const html = render(createElement(DeviceEngineReadout));
		expect(html).toContain("Not in this build");
		expect(html).not.toContain("Check now");
		expect(instance.deviceController).not.toHaveBeenCalled();
	});

	it("with the flag shows the last report and a check button", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "1");
		instance.deviceController.mockReturnValue({
			...controller,
			reports: { home: report() },
		});
		const html = render(createElement(DeviceEngineReadout));
		expect(html).toContain("Check now");
		expect(html).toContain("Differs from the server");
		expect(html).not.toContain("987654321");
	});
});

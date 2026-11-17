import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParityReport } from "~/lib/device-engine/protocol";
import en from "../../../../../packages/i18n/messages/en/deviceEngine.json";

const controller = vi.hoisted(() => ({
	lastParity: null as unknown,
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
import { ParityView } from "../view";

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
const report = {
	state: "checked",
	ids: ["glance.spent", "glance.spentLast"],
	mismatchedIds: ["glance.spentLast"],
	counts: [
		{ id: "glance.spent", device: 1, server: 1 },
		{ id: "glance.spentLast", device: 1, server: 2 },
	],
	generation: 3,
	storedZone: "UTC",
	browserZone: "America/Argentina/Buenos_Aires",
	zoneDiffers: true,
	lines: [{ minor: 987654321, currency: "ARS" }],
	mismatches: [
		{
			id: "glance.spentLast",
			device: [{ minor: 424242424 }],
			server: [{ minor: 515151515 }],
		},
	],
} as unknown as ParityReport;

describe("the readout's view", () => {
	it("shows ids, words and counts, never an amount", () => {
		const html = render(
			createElement(ParityView, {
				report,
				lastPullAt: "2026-11-17T12:00:00.000Z",
				phase: "running",
			}),
		);
		expect(html).toContain("Differs from the server");
		expect(html).toContain("glance.spentLast");
		expect(html).toContain(
			"Matches, 1 line on the device, 1 line on the server",
		);
		expect(html).toContain(
			"Differs, 1 line on the device, 2 lines on the server",
		);
		expect(html).toContain("America/Argentina/Buenos_Aires");
		expect(html).toContain("Differ");
		for (const minor of ["987654321", "424242424", "515151515"])
			expect(html).not.toContain(minor);
		expect(html).not.toContain("ARS");
	});

	it("shows an unknown marker for a count it does not have, never a zero", () => {
		const unknown = {
			...report,
			counts: [{ id: "glance.spentLast", device: 1, server: null }],
		} as unknown as ParityReport;
		const html = render(
			createElement(ParityView, {
				report: unknown,
				lastPullAt: null,
				phase: "running",
			}),
		);
		expect(html).toContain(
			"Differs, 1 line on the device, Unknown on the server",
		);
		expect(html).not.toContain("0 lines");
	});

	it("names each state in words", () => {
		const base = { ...report, mismatchedIds: [] } as ParityReport;
		const words = (state: ParityReport["state"]) =>
			render(
				createElement(ParityView, {
					report: { ...base, state },
					lastPullAt: null,
					phase: "running",
				}),
			);
		expect(words("checked")).toContain("Matches the server");
		expect(words("failed")).toContain("The check did not finish");
		expect(words("skipped")).toContain("Nothing to check yet");
		expect(
			render(
				createElement(ParityView, {
					report: null,
					lastPullAt: null,
					phase: "off",
				}),
			),
		).toContain("No check has run yet");
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
			lastParity: report,
		});
		const html = render(createElement(DeviceEngineReadout));
		expect(html).toContain("Check now");
		expect(html).toContain("Differs from the server");
		expect(html).not.toContain("987654321");
	});
});

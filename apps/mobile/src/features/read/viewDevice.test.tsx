import type { RetrospendClient } from "@retrospend/api-client";
import type { ReactNode } from "react";
import { InsightsScreen } from "@/features/insights/InsightsScreen";
import { RecurringView } from "@/features/recurring/RecurringView";
import { WealthView } from "@/features/wealth/WealthView";

// The three views with the dev flag's device engine: each builds its fetch
// from useDeviceReads(), so the device is asked to compare when there is one,
// and the fetch is today's call when there is none. A compare that never
// answers does not hold the fetch. The render stops at useCachedRead, which
// hands over the fetch the view built.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockStop = new Error("stop at useCachedRead");
const mockCaptured: { fetch: (() => Promise<unknown>) | null } = {
	fetch: null,
};
const mockHeld: { device: { compare: jest.Mock } | null } = { device: null };

jest.mock("use-intl", () => ({ useTranslations: () => (k: string) => k }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("@/data/useDeviceEngine", () => ({
	useDeviceReads: () => mockHeld.device,
}));
jest.mock("@/features/read/useCachedRead", () => ({
	useCachedRead: (_key: unknown, fetch: () => Promise<unknown>) => {
		mockCaptured.fetch = fetch;
		throw mockStop;
	},
}));
jest.mock("@/layout/useLayoutClass", () => ({
	useLayoutClass: () => ({ widthClass: "compact", columns: false }),
}));
jest.mock("@/theme", () => ({ useTheme: () => ({ space: (n: number) => n }) }));
jest.mock("@/features/entry/AddEntryProvider", () => ({
	useAddEntry: () => ({ open: () => {} }),
	useOptionalAddEntry: () => null,
}));
jest.mock("@/features/insights/useInsightsWords", () => ({
	useInsightsWords: () => ({}),
}));

const mockApi = {
	accounts: {
		list: async () => ({ accounts: [{ id: "a1" }] }),
		netWorth: async () => ({}),
		summary: async () => ({}),
		order: async () => ({}),
	},
	recurring: {
		list: async () => ({ items: [{ id: "r1" }] }),
		summary: async () => ({}),
	},
	figures: {
		firstDay: async () => ({ day: "2026-01-01" }),
		insightsSummary: async () => ({ categories: [{ categoryId: "c1" }] }),
		insightsMonths: async () => ({ months: [{ month: "2026-10" }] }),
		insightsYtd: async () => ({ categories: [] }),
		insightsCashflow: async () => ({}),
	},
} as unknown as RetrospendClient;

function fetchOf(View: () => ReactNode) {
	mockCaptured.fetch = null;
	try {
		act(() => {
			create(<View />);
		});
	} catch (error) {
		if (error !== mockStop) throw error;
	}
	return mockCaptured.fetch as unknown as () => Promise<unknown>;
}

const never = () => jest.fn(() => new Promise(() => {}));
const views = [
	["wealth", WealthView, { accountId: ["a1"] }],
	["recurring", RecurringView, { recurringId: ["r1"] }],
	["insights", InsightsScreen, { categoryId: ["c1"], month: ["2026-10"] }],
] as const;

describe.each(views)("%s", (screen, View, narrowings) => {
	it("asks the device to compare with the ids it lists", async () => {
		mockHeld.device = { compare: jest.fn(async () => null) };
		await fetchOf(View as () => ReactNode)();
		expect(mockHeld.device.compare).toHaveBeenCalledWith(screen, narrowings);
	});

	it("reads as today with no device", async () => {
		mockHeld.device = null;
		await expect(fetchOf(View as () => ReactNode)()).resolves.toBeDefined();
	});

	it("does not wait for a compare that never answers", async () => {
		mockHeld.device = { compare: never() };
		await expect(fetchOf(View as () => ReactNode)()).resolves.toBeDefined();
		expect(mockHeld.device.compare).toHaveBeenCalledTimes(1);
	});
});

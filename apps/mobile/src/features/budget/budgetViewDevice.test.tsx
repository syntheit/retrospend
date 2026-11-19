import type { RetrospendClient } from "@retrospend/api-client";
import { BudgetView } from "./BudgetView";
import type { BudgetMonth, BudgetRead, Verdict } from "./source";

// BudgetView with the dev flag's device engine: the device is only held
// against the server in the background, so the body and every sheet get the
// server's answer and nothing of the device's.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockCaptured: {
	fetch: (() => Promise<BudgetRead>) | null;
	state: unknown;
	body: Record<string, unknown> | null;
	sheets: Record<string, unknown> | null;
} = { fetch: null, state: { status: "loading" }, body: null, sheets: null };

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }));
jest.mock("use-intl", () => require("./harness").intlMock);
jest.mock("@/auth/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("@/data/ids", () => ({ newClientId: () => "id" }));
jest.mock("@/data/useDeviceEngine", () => ({
	useDeviceReads: () => mockDevice,
}));
jest.mock("@/features/account/AccountTopBar", () => ({
	AccountTopBar: () => null,
}));
jest.mock("@/features/read/useCachedRead", () => ({
	useCachedRead: (_key: unknown, fetch: () => Promise<BudgetRead>) => {
		mockCaptured.fetch = fetch;
		return { state: mockCaptured.state, reload: async () => {} };
	},
}));
jest.mock("@/features/read/useReloadOnEntryChange", () => ({
	useReloadOnEntryChange: () => {},
}));
jest.mock("@/layout/useLayoutClass", () => ({
	useLayoutClass: () => ({ widthClass: "compact", columns: false }),
}));
jest.mock("@/lib/flags", () => ({ GALLERY_ENABLED: false }));
jest.mock("@/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("@/ui/Screen", () => ({
	Screen: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));
jest.mock("./BudgetBody", () => ({
	BudgetBody: (props: Record<string, unknown>) => {
		mockCaptured.body = props;
		return null;
	},
}));
jest.mock("./BudgetSheets", () => ({
	BudgetSheets: (props: Record<string, unknown>) => {
		mockCaptured.sheets = props;
		return null;
	},
}));
jest.mock("./devSheet", () => ({ devSheet: () => null }));
jest.mock("./EnvelopeInspector", () => ({
	EnvelopeInspector: () => null,
	INSPECTOR_MIN_WIDTH: 1000,
}));
jest.mock("./ManageList", () => ({ useManageItems: () => [] }));
jest.mock("./SetupSheet", () => ({ SetupSheet: () => null }));

const ars = (minor: number) => ({ minor, currency: "ARS" });
const verdict = (minor: number) =>
	({
		style: "FLEX",
		month: 202610,
		lead: {
			kind: "LEFT_TO_SPEND",
			figureId: "budget.leftToSpend",
			amount: ars(minor),
		},
		state: "ON_TRACK",
		incomplete: false,
	}) as unknown as Verdict;
const month = {
	book: {
		id: "book",
		currency: "ARS",
		style: "FLEX",
		paused: false,
		startMonth: 202601,
	},
	month: { key: 202610, state: "OPEN" },
	today: "2026-10-15",
	incomplete: false,
	approximate: false,
	verdict: verdict(5_000_000),
} as unknown as BudgetMonth;

const mockApi = {
	budget: { month: async () => month, payoffProjection: async () => null },
} as unknown as RetrospendClient;

const mockDevice = { compare: jest.fn(async () => null) };

it("hands the body and every sheet the server's month only, though the device's verdict differs", async () => {
	let tree: { update(element: unknown): void } | undefined;
	act(() => {
		tree = create(<BudgetView />);
	});
	// The screen reads through the fetch it built from the device.
	mockCaptured.state = {
		status: "ready",
		data: await (mockCaptured.fetch as () => Promise<BudgetRead>)(),
		staleSince: null,
		refreshing: false,
	};
	act(() => {
		tree?.update(<BudgetView />);
	});

	// The fetch BudgetView built asked the device, so the compare ran.
	expect(mockDevice.compare).toHaveBeenCalledWith(
		"budget",
		{},
		expect.any(Function),
	);
	expect(mockCaptured.body?.data).toBe(month);
	expect(mockCaptured.sheets?.data).toBe(month);
	for (const props of [mockCaptured.body, mockCaptured.sheets])
		expect(Object.keys(props ?? {})).not.toContain("heroOverride");
});

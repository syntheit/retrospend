import { NotificationsScreen } from "./NotificationsScreen";
import type { InboxData, InboxNotification } from "./source";

// The inbox screen: rows grouped by day, a tap opens the thing and marks it
// read, the header carries Mark all read and the settings, and the empty,
// loading and failed states. The data hook and the native pieces are
// stand-ins; the screen only lays them out.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

type Json = Record<string, unknown>;
let mockHeader: { headerRight?: () => unknown } = {};
const mockPush = jest.fn();
const mockOpen = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAll = jest.fn();
const mockShowMore = jest.fn();
let mockInbox: Json;

jest.mock("expo-router", () => ({
	router: { push: (to: string) => mockPush(to) },
	Stack: {
		Screen: ({ options }: { options: typeof mockHeader }) => {
			mockHeader = options;
			return null;
		},
	},
}));
jest.mock("use-intl", () => ({
	useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
jest.mock("@/theme", () => ({
	useTheme: () => ({ space: { 2: 8, 4: 16 } }),
}));
jest.mock("@/features/activity/DayHeader", () => ({
	useDayLabel: () => (day: string) => day,
	DayHeader: (props: Json) =>
		require("react").createElement("DayHeader", props),
}));
jest.mock("@/ui/Screen", () => ({
	Screen: (props: { children: unknown }) =>
		require("react").createElement("Screen", null, props.children),
}));
jest.mock("@/ui/List", () => ({
	StaleNote: () => null,
	ListGroup: (props: { children: unknown }) =>
		require("react").createElement("ListGroup", null, props.children),
	LinkButton: (props: Json) =>
		require("react").createElement("LinkButton", props),
}));
jest.mock("@/ui/EmptyState", () => ({
	EmptyState: (props: Json) =>
		require("react").createElement("EmptyState", props),
}));
jest.mock("@/ui/Segmented", () => ({
	Segmented: (props: Json) =>
		require("react").createElement("Segmented", props),
}));
jest.mock("@/ui/Skeleton", () => ({
	SkeletonRows: () => require("react").createElement("SkeletonRows"),
}));
jest.mock("@/ui/TopBarAction", () => ({
	TopBarAction: (props: Json) =>
		require("react").createElement("TopBarAction", props),
}));
jest.mock("./NotificationRow", () => ({
	NotificationRow: (props: Json) =>
		require("react").createElement("NotificationRow", props),
}));
jest.mock("./openTarget", () => ({
	openTarget: (target: unknown) => mockOpen(target),
}));
jest.mock("./useInbox", () => ({ useInbox: () => mockInbox }));

function note(over: Partial<InboxNotification>): InboxNotification {
	return {
		id: "n1",
		type: "EXPENSE_SPLIT",
		title: "New shared expense",
		body: "Lucia split Dinner with you",
		data: { transactionId: "t1" },
		isRead: false,
		createdAt: new Date().toISOString(),
		...over,
	};
}

function inbox(over: Partial<InboxData> = {}, extra: Json = {}) {
	const data: InboxData = {
		items: [],
		nextCursor: null,
		people: [],
		projects: [],
		...over,
	};
	mockInbox = {
		state: { status: "ready", data, staleSince: null, refreshing: false },
		data,
		unread: data.items.filter((n) => !n.isRead).length,
		refreshing: false,
		refresh: jest.fn(),
		reload: jest.fn(),
		markRead: mockMarkRead,
		markAllRead: mockMarkAll,
		showMore: mockShowMore,
		loadingMore: false,
		...extra,
	};
}

function render() {
	let tree!: {
		root: {
			findAllByType(t: string): { props: Json }[];
			findByType(t: string): { props: Json };
		};
		unmount(): void;
	};
	act(() => {
		tree = create(<NotificationsScreen />);
	});
	return tree;
}

/** The header's actions, rendered from headerRight. */
function headerActions() {
	let tree!: {
		root: { findAllByType(t: string): { props: Json }[] };
		unmount(): void;
	};
	act(() => {
		tree = create(mockHeader.headerRight?.() as never);
	});
	const actions = tree.root.findAllByType("TopBarAction").map((a) => a.props);
	act(() => tree.unmount());
	return actions;
}

/** Presses a prop of a rendered stand-in (props or the props themselves). */
function fire(target: { props: Json } | Json | undefined, name: string) {
	const props = target && "props" in target ? (target.props as Json) : target;
	const fn = props?.[name];
	if (typeof fn !== "function") throw new Error(`no ${name} to call`);
	act(() => {
		fn();
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockHeader = {};
});

describe("NotificationsScreen", () => {
	it("lists a day's rows under its label and opens the thing on a tap, marking it read", () => {
		inbox({
			items: [
				note({ id: "a" }),
				note({
					id: "b",
					isRead: true,
					data: { projectId: "p1" },
					type: "PERIOD_CLOSED",
				}),
			],
		});
		const tree = render();
		expect(tree.root.findAllByType("DayHeader")).toHaveLength(1);
		const rows = tree.root.findAllByType("NotificationRow");
		expect(rows).toHaveLength(2);
		fire(rows[0], "onOpen");
		expect(mockMarkRead).toHaveBeenCalledWith(["a"]);
		expect(mockOpen).toHaveBeenCalledWith({ kind: "entry", id: "shared:t1" });
		// A note that is already read opens without being marked again.
		fire(rows[1], "onOpen");
		expect(mockMarkRead).toHaveBeenCalledTimes(1);
		expect(mockOpen).toHaveBeenLastCalledWith({ kind: "project", id: "p1" });
		act(() => tree.unmount());
	});

	it("marks one read from the row's own action", () => {
		inbox({ items: [note({ id: "a" })] });
		const tree = render();
		const row = tree.root.findByType("NotificationRow");
		fire(row, "onMarkRead");
		expect(mockMarkRead).toHaveBeenCalledWith(["a"]);
		expect(mockOpen).not.toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("has Mark all read and the settings in the header while something is unread", () => {
		inbox({ items: [note({ id: "a" })] });
		const tree = render();
		const actions = headerActions();
		expect(actions.map((a) => a.id)).toEqual(["markAll", "settings"]);
		fire(actions[0], "onPress");
		expect(mockMarkAll).toHaveBeenCalled();
		fire(actions[1], "onPress");
		expect(mockPush).toHaveBeenCalledWith("/settings/notifications");
		act(() => tree.unmount());
	});

	it("drops Mark all read once everything is read, and keeps the settings", () => {
		inbox({ items: [note({ id: "a", isRead: true })] });
		const tree = render();
		expect(headerActions().map((a) => a.id)).toEqual(["settings"]);
		act(() => tree.unmount());
	});

	it("keeps Mark all read when older pages may hold unread notes", () => {
		inbox({ items: [note({ id: "a", isRead: true })], nextCursor: "next" });
		const tree = render();
		expect(headerActions().map((a) => a.id)).toEqual(["markAll", "settings"]);
		fire(tree.root.findByType("LinkButton"), "onPress");
		expect(mockShowMore).toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("filters by kind like the web inbox and says when a filter is empty", () => {
		inbox({
			items: [
				note({ id: "a" }),
				note({ id: "b", type: "PERIOD_CLOSED", data: { projectId: "p1" } }),
			],
		});
		const tree = render();
		const segmented = tree.root.findByType("Segmented");
		const options = segmented.props.options as { value: string }[];
		expect(options.map((o) => o.value)).toEqual([
			"all",
			"expenses",
			"settlements",
			"projects",
		]);
		expect(tree.root.findAllByType("NotificationRow")).toHaveLength(2);
		act(() => (segmented.props.onChange as (v: string) => void)("projects"));
		expect(tree.root.findAllByType("NotificationRow")).toHaveLength(1);
		act(() => (segmented.props.onChange as (v: string) => void)("settlements"));
		expect(tree.root.findAllByType("NotificationRow")).toHaveLength(0);
		expect(tree.root.findByType("EmptyState").props.title).toBe(
			"mobile.notifications.noMatches",
		);
		act(() => tree.unmount());
	});

	it("shows no filter while there is nothing to filter", () => {
		inbox();
		const tree = render();
		expect(tree.root.findAllByType("Segmented")).toHaveLength(0);
		act(() => tree.unmount());
	});

	it("says there is nothing yet", () => {
		inbox();
		const tree = render();
		expect(tree.root.findByType("EmptyState").props.title).toBe(
			"mobile.notifications.empty",
		);
		expect(headerActions().map((a) => a.id)).toEqual(["settings"]);
		act(() => tree.unmount());
	});

	it("shows rows in place while loading, and a retry when it failed", () => {
		mockInbox = { state: { status: "loading" }, data: null };
		let tree = render();
		expect(tree.root.findAllByType("SkeletonRows")).toHaveLength(1);
		act(() => tree.unmount());

		const reload = jest.fn();
		mockInbox = { state: { status: "error" }, data: null, reload };
		tree = render();
		const empty = tree.root.findByType("EmptyState");
		expect(empty.props.title).toBe("mobile.notifications.error");
		fire(empty, "onAction");
		expect(reload).toHaveBeenCalled();
		act(() => tree.unmount());
	});
});

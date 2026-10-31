import type { InboxData, InboxNotification } from "./source";
import { useInbox } from "./useInbox";

// Marking read changes the rows at once, saves to the server and the phone's
// copy, and goes back to the server's word with a toast when the save fails.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockToast = jest.fn();
const mockReload = jest.fn(async () => undefined);
const mockWrite = jest.fn(async () => undefined);
const mockMarkRead = jest.fn(async (_: { id: string }) => ({ ok: true }));
const mockMarkAll = jest.fn(async () => ({ count: 2 }));
const mockList = jest.fn();
let mockData: InboxData;

jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("@/ui/Toast", () => ({
	useToast: () => ({ show: mockToast }),
}));
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: {
			notifications: {
				markRead: mockMarkRead,
				markAllRead: mockMarkAll,
				list: mockList,
			},
		},
		local: { cache: { write: mockWrite } },
	}),
}));
// The state keeps its identity between renders, as the real hook's does.
let mockState: object;
jest.mock("@/features/read/useCachedRead", () => ({
	useCachedRead: () => ({ state: mockState, reload: mockReload }),
}));
jest.mock("./source", () => ({
	...jest.requireActual("./source"),
	fetchInbox: () => async () => mockData,
}));

function note(id: string, isRead = false): InboxNotification {
	return {
		id,
		type: "EXPENSE_SPLIT",
		title: "t",
		body: "b",
		data: null,
		isRead,
		createdAt: "2026-10-30T15:00:00.000Z",
	};
}

type Inbox = ReturnType<typeof useInbox>;
let current: Inbox;

function Harness() {
	current = useInbox();
	return null;
}

function mount() {
	let tree!: { unmount(): void };
	act(() => {
		tree = create(<Harness />);
	});
	return tree;
}

beforeEach(() => {
	jest.clearAllMocks();
	mockData = {
		items: [note("a"), note("b"), note("c", true)],
		nextCursor: "next",
		people: [],
		projects: [],
	};
	mockState = {
		status: "ready",
		data: mockData,
		staleSince: null,
		refreshing: false,
	};
});

describe("useInbox", () => {
	it("starts from the read and counts the unread", () => {
		const tree = mount();
		expect(current.data?.items).toHaveLength(3);
		expect(current.unread).toBe(2);
		act(() => tree.unmount());
	});

	it("marks one read at once, saves it and keeps the phone's copy", async () => {
		const tree = mount();
		await act(async () => {
			await current.markRead(["a"]);
		});
		expect(current.unread).toBe(1);
		expect(mockMarkRead).toHaveBeenCalledWith({ id: "a" });
		expect(mockWrite).toHaveBeenCalledTimes(1);
		const kept = (mockWrite.mock.calls[0] as unknown[])[2] as InboxData;
		expect(kept.items.find((n) => n.id === "a")?.isRead).toBe(true);
		expect(mockToast).not.toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("marks all read, and reads again with a toast when the save fails", async () => {
		const tree = mount();
		await act(async () => {
			await current.markAllRead();
		});
		expect(mockMarkAll).toHaveBeenCalled();
		expect(current.unread).toBe(0);

		mockMarkRead.mockRejectedValueOnce(new Error("offline"));
		await act(async () => {
			await current.markRead(["b"]);
		});
		expect(mockToast).toHaveBeenCalledWith({ message: "markError" });
		expect(mockReload).toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("adds the next page below", async () => {
		mockList.mockResolvedValueOnce({
			items: [note("d"), note("c", true)],
			nextCursor: null,
		});
		const tree = mount();
		await act(async () => {
			await current.showMore();
		});
		expect(mockList).toHaveBeenCalledWith({ limit: 50, cursor: "next" });
		expect(current.data?.items.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
		expect(current.data?.nextCursor).toBeNull();
		act(() => tree.unmount());
	});
});

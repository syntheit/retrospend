import { createElement } from "react";
import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { invalidateReads } from "./readLedger";
import { useCachedRead } from "./useCachedRead";

// The read hook's rules about when a screen asks the server again: once for
// two screens that ask together, not on a return to focus within the window
// (unless a write happened), always on an explicit reload, and no new state
// when the answer is the rows already on screen.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

let mockFocus: (() => void) | null = null;
let mockCache: ReturnType<typeof createReadCache>;
// Stable, like the real session's: a new object each render would reload forever.
let mockSession: { local: { cache: ReturnType<typeof createReadCache> } };

jest.mock("expo-router", () => ({
	useFocusEffect: (effect: () => void) => {
		mockFocus = effect;
		require("react").useEffect(effect, [effect]);
	},
}));
jest.mock("@/auth/session", () => ({
	useSession: () => mockSession,
}));

const KEY = { name: "hook.thing", schema: 1 };

type Seen = ReturnType<typeof useCachedRead<{ n: number }>>;

function mount(
	fetch: () => Promise<{ n: number }>,
	options?: { passive?: boolean },
	name = KEY.name,
) {
	const seen: Seen[] = [];
	const Probe = () => {
		const read = useCachedRead({ ...KEY, name }, fetch, undefined, options);
		seen.push(read);
		return null;
	};
	let tree: { unmount(): void };
	act(() => {
		tree = create(createElement(Probe));
	});
	// biome-ignore lint/style/noNonNullAssertion: assigned in act
	return { seen, tree: tree!, last: () => seen[seen.length - 1] as Seen };
}

const settle = () => act(async () => {});

let n = 0;
beforeEach(() => {
	mockCache = createReadCache(createMemoryStore(), `hook${n++}`);
	mockSession = { local: { cache: mockCache } };
});

describe("useCachedRead", () => {
	it("sends one request when two screens read the same thing at once", async () => {
		const fetch = jest.fn(async () => ({ n: 1 }));
		const a = mount(fetch);
		const b = mount(fetch);
		await settle();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(a.last().state.status).toBe("ready");
		expect(b.last().state.status).toBe("ready");
	});

	it("does not ask again on a return to focus within the window", async () => {
		const fetch = jest.fn(async () => ({ n: 1 }));
		const screen = mount(fetch);
		await settle();
		expect(fetch).toHaveBeenCalledTimes(1);
		await act(async () => mockFocus?.());
		expect(fetch).toHaveBeenCalledTimes(1);
		act(() => screen.tree.unmount());
	});

	it("asks again on a return to focus once a write reached the server", async () => {
		const fetch = jest.fn(async () => ({ n: 1 }));
		const screen = mount(fetch);
		await settle();
		invalidateReads();
		await act(async () => mockFocus?.());
		expect(fetch).toHaveBeenCalledTimes(2);
		act(() => screen.tree.unmount());
	});

	it("asks again on a return to focus after the window", async () => {
		const fetch = jest.fn(async () => ({ n: 1 }));
		const screen = mount(fetch);
		await settle();
		const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
		await act(async () => mockFocus?.());
		spy.mockRestore();
		expect(fetch).toHaveBeenCalledTimes(2);
		act(() => screen.tree.unmount());
	});

	it("always asks on an explicit reload", async () => {
		const fetch = jest.fn(async () => ({ n: 1 }));
		const screen = mount(fetch);
		await settle();
		await act(async () => {
			await screen.last().reload();
		});
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("keeps the same rows and does not render again when the answer did not change", async () => {
		const fetch = jest.fn(async () => ({ n: 1 }));
		const screen = mount(fetch);
		await settle();
		const first = screen.last().state;
		const renders = screen.seen.length;
		await act(async () => {
			await screen.last().reload();
		});
		expect(screen.last().state).toBe(first);
		expect(screen.seen.length).toBe(renders);
	});

	it("shows new rows when the answer changed", async () => {
		let n = 1;
		const fetch = jest.fn(async () => ({ n: n++ }));
		const screen = mount(fetch);
		await settle();
		await act(async () => {
			await screen.last().reload();
		});
		expect(screen.last().state).toMatchObject({
			status: "ready",
			data: { n: 2 },
		});
	});

	it("a passive read uses the cache and never asks on a return to focus", async () => {
		await mockCache.write(KEY.name, KEY.schema, { n: 5 });
		const fetch = jest.fn(async () => ({ n: 6 }));
		const screen = mount(fetch, { passive: true });
		await settle();
		expect(screen.last().state).toMatchObject({
			status: "ready",
			data: { n: 5 },
		});
		await act(async () => mockFocus?.());
		expect(fetch).not.toHaveBeenCalled();
	});

	it("a passive read asks the server once when nothing is cached", async () => {
		const fetch = jest.fn(async () => ({ n: 6 }));
		const screen = mount(fetch, { passive: true });
		await settle();
		expect(screen.last().state).toMatchObject({
			status: "ready",
			data: { n: 6 },
		});
		await act(async () => mockFocus?.());
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

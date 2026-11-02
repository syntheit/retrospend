import type { RetrospendClient } from "@retrospend/api-client";
import { AppState, type AppStateStatus } from "react-native";
import {
	act,
	flush,
	lastToast,
	makeLocal,
	renderHook,
	world,
} from "../../../test/harness";
import { subscribeEntryChanges } from "./events";
import { forgetUndoTokens } from "./send";
import { useOutboxFlush } from "./useOutboxFlush";

// What waits in the outbox goes out by itself: on open, when the app comes
// back to the foreground and when the network returns. A write that the
// server refuses is parked and says so, since nobody has the composer open.

type Call = { route: string; input: unknown; key?: string };

function fakeApi(
	fail: Record<string, unknown> = {},
	gate?: Promise<void>,
): { api: RetrospendClient; calls: Call[] } {
	const calls: Call[] = [];
	const create =
		(route: string) =>
		async (
			input: unknown,
			init?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({ route, input, key: init?.context?.idempotencyKey });
			if (gate) await gate;
			if (route in fail) throw fail[route];
			return { undo: `tok-${route}` };
		};
	const api = {
		expenses: { create: create("expenses") },
		"shared-expenses": { create: create("shared-expenses") },
		income: { create: create("income") },
		transfers: { create: create("transfers") },
	} as unknown as RetrospendClient;
	return { api, calls };
}

const NO_ANSWER = new Error("Network request failed");
const refused = (status: number) => Object.assign(new Error("no"), { status });

function waiting(
	clientId: string,
	entity: string,
	payload: Record<string, unknown>,
) {
	return world.local.outbox.enqueue({
		clientId,
		entity,
		kind: "create",
		targetId: clientId,
		baseVersion: null,
		payload,
	});
}

const YEN = { id: "a", title: "Ramen", amount: "1500", currency: "JPY" };
const DINAR = { id: "b", title: "Taxi", amount: "12.345", currency: "KWD" };

let changes: jest.Mock;
let unsubscribe: () => void;
let handlers: ((state: AppStateStatus) => void)[];
let removed: jest.Mock;
beforeEach(() => {
	forgetUndoTokens();
	changes = jest.fn();
	unsubscribe = subscribeEntryChanges(changes);
	handlers = [];
	removed = jest.fn();
	jest
		.spyOn(AppState, "addEventListener")
		.mockImplementation((_type, handler) => {
			handlers.push(handler as (state: AppStateStatus) => void);
			return { remove: removed };
		});
});
afterEach(() => {
	unsubscribe();
	jest.restoreAllMocks();
});

const settled = () => act(async () => {});

describe("when the app opens", () => {
	it("sends what waits, yen and dinars as written, each under its client id", async () => {
		const { api, calls } = fakeApi();
		world.api = api;
		await waiting("a", "expenses", YEN);
		await waiting("b", "shared-expenses", DINAR);
		await renderHook(() => useOutboxFlush());
		await settled();

		expect(calls).toEqual([
			{ route: "expenses", input: YEN, key: "a" },
			{ route: "shared-expenses", input: DINAR, key: "b" },
		]);
		expect(await world.local.outbox.all()).toHaveLength(0);
		// Screens that list entries reload, and nothing is announced aloud.
		expect(changes).toHaveBeenCalled();
		expect(world.toast.show).not.toHaveBeenCalled();
	});

	it("says nothing and announces nothing when nothing waits", async () => {
		const { api, calls } = fakeApi();
		world.api = api;
		await renderHook(() => useOutboxFlush());
		await settled();
		expect(calls).toHaveLength(0);
		expect(changes).not.toHaveBeenCalled();
		expect(world.toast.show).not.toHaveBeenCalled();
	});

	it("leaves entries of other kinds where they are", async () => {
		const { api, calls } = fakeApi();
		world.api = api;
		await waiting("x", "accounts", { id: "x" });
		await waiting("a", "expenses", YEN);
		await renderHook(() => useOutboxFlush());
		await settled();
		expect(calls.map((c) => c.route)).toEqual(["expenses"]);
		const left = await world.local.outbox.all();
		expect(left.map((e) => e.clientId)).toEqual(["x"]);
	});
});

describe("when it can not send", () => {
	it("keeps a write the network dropped, without a toast", async () => {
		const { api, calls } = fakeApi({ expenses: NO_ANSWER });
		world.api = api;
		await waiting("a", "expenses", YEN);
		await renderHook(() => useOutboxFlush());
		await settled();
		expect(calls).toHaveLength(1);
		const left = await world.local.outbox.all();
		expect(left).toHaveLength(1);
		expect(left[0]?.state).not.toBe("conflict");
		expect(changes).not.toHaveBeenCalled();
		expect(world.toast.show).not.toHaveBeenCalled();
	});

	it("does not try without a connection, a server or an account", async () => {
		const { api, calls } = fakeApi();
		await waiting("a", "expenses", YEN);

		world.api = api;
		world.reachable = false;
		await renderHook(() => useOutboxFlush());
		world.reachable = true;
		world.api = undefined;
		await renderHook(() => useOutboxFlush());
		world.api = api;
		world.local = null as never;
		await renderHook(() => useOutboxFlush());
		await settled();

		expect(calls).toHaveLength(0);
	});

	it("treats an unknown connection as online", async () => {
		const { api, calls } = fakeApi();
		world.api = api;
		world.reachable = null;
		await waiting("a", "expenses", YEN);
		await renderHook(() => useOutboxFlush());
		await settled();
		expect(calls).toHaveLength(1);
	});
});

describe("a write the server refuses", () => {
	it("is parked and the toast says one entry stays on the phone", async () => {
		const { api } = fakeApi({ expenses: refused(422) });
		world.api = api;
		await waiting("a", "expenses", YEN);
		await renderHook(() => useOutboxFlush());
		await settled();

		expect(lastToast().message).toBe(
			"1 entry couldn't be added. It stays on this phone.",
		);
		expect(lastToast().undo).toBeUndefined();
		expect(changes).toHaveBeenCalled();
		const left = await world.local.outbox.all();
		expect(left[0]?.state).toBe("conflict");
	});

	it("counts every refused entry in one toast, and still sends the rest", async () => {
		const { api, calls } = fakeApi({
			expenses: refused(422),
			"shared-expenses": refused(400),
		});
		world.api = api;
		await waiting("a", "expenses", YEN);
		await waiting("b", "shared-expenses", DINAR);
		await waiting("c", "income", { id: "c" });
		await renderHook(() => useOutboxFlush());
		await settled();

		expect(calls.map((c) => c.route)).toEqual([
			"expenses",
			"shared-expenses",
			"income",
		]);
		expect(world.toast.show).toHaveBeenCalledTimes(1);
		expect(lastToast().message).toBe(
			"2 entries couldn't be added. They stay on this phone.",
		);
	});
});

describe("when the app comes back", () => {
	it("sends again on the foreground, and not on the background", async () => {
		const { api, calls } = fakeApi();
		world.api = api;
		await renderHook(() => useOutboxFlush());
		await settled();
		expect(handlers).toHaveLength(1);

		await waiting("a", "expenses", YEN);
		await act(async () => handlers[0]?.("background"));
		await act(async () => handlers[0]?.("inactive"));
		expect(calls).toHaveLength(0);

		await act(async () => handlers[0]?.("active"));
		await settled();
		expect(calls).toEqual([{ route: "expenses", input: YEN, key: "a" }]);
	});

	it("sends when the network returns", async () => {
		const { api, calls } = fakeApi();
		world.api = api;
		world.reachable = false;
		await waiting("a", "expenses", YEN);
		const hook = await renderHook(() => useOutboxFlush());
		await settled();
		expect(calls).toHaveLength(0);

		world.reachable = true;
		await hook.rerender();
		await settled();
		expect(calls).toHaveLength(1);
		expect(await world.local.outbox.all()).toHaveLength(0);
	});

	it("sends a dropped write again under the same key when the network flaps", async () => {
		const { api, calls } = fakeApi({ expenses: NO_ANSWER });
		world.api = api;
		await waiting("a", "expenses", YEN);
		const hook = await renderHook(() => useOutboxFlush());
		await settled();
		expect(calls).toHaveLength(1);

		// The same write goes again under the same key, never a second row.
		(api.expenses as { create: unknown }).create = async (
			input: unknown,
			init?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({
				route: "expenses",
				input,
				key: init?.context?.idempotencyKey,
			});
			return { undo: "tok" };
		};
		world.reachable = false;
		await hook.rerender();
		world.reachable = true;
		await hook.rerender();
		await settled();
		expect(calls).toHaveLength(2);
		expect(calls[1]?.key).toBe(calls[0]?.key);
		expect(await world.local.outbox.all()).toHaveLength(0);
	});
});

describe("when it stops", () => {
	it("stops listening when the screen goes away", async () => {
		world.api = fakeApi().api;
		const hook = await renderHook(() => useOutboxFlush());
		await settled();
		expect(removed).not.toHaveBeenCalled();
		await hook.unmount();
		expect(removed).toHaveBeenCalledTimes(1);
	});

	it("reports nothing of a run that the account change ended", async () => {
		let open!: () => void;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const slow = fakeApi({ expenses: refused(422) }, gate);
		world.api = slow.api;
		await waiting("a", "expenses", YEN);
		const hook = await renderHook(() => useOutboxFlush());
		await flush();
		expect(slow.calls).toHaveLength(1);

		// Another account signs in: a new client and its own, empty outbox.
		const next = fakeApi();
		world.api = next.api;
		world.local = makeLocal("https://example.test|me2");
		await hook.rerender();
		await act(async () => {
			open();
		});
		await settled();

		expect(world.toast.show).not.toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
		expect(next.calls).toHaveLength(0);
		expect(removed).toHaveBeenCalledTimes(1);
	});
});

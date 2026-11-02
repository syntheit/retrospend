import type { RetrospendClient } from "@retrospend/api-client";
import { act, lastToast, renderHook, world } from "../../../test/harness";
import {
	buildExpenseUpdate,
	buildExpenseWrite,
	buildIncomeWrite,
	buildTransferWrite,
	newExpenseDraft,
	newIncomeDraft,
	newTransferDraft,
	type PendingWrite,
} from "./draft";
import { subscribeEntryChanges } from "./events";
import { forgetUndoTokens } from "./send";
import type { EntryCatalog } from "./types";
import type { EntryForm } from "./useEntryForm";
import { useEntrySave } from "./useEntrySave";

// Add and Save through the hook, with the real outbox, queue and sender over
// a fake API: what is sent for yen and dinars, the toast each outcome ends
// in, and Undo that works and Undo that does not.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const catalog: EntryCatalog = {
	categories: [
		{
			id: "food",
			name: "Food",
			icon: null,
			tone: 3,
			uses: 1,
			excludeByDefault: false,
		},
	],
	people: [{ type: "user", id: "lucia1", name: "Lucía", imageUrl: null }],
	currencies: ["JPY", "KWD"],
	recentCurrencies: [],
	places: [
		{ id: "yen", name: "Yen", type: "CHECKING", currency: "JPY" },
		{ id: "dinar", name: "Dinar", type: "SAVINGS", currency: "KWD" },
	],
	projects: [],
	hasBudget: null,
};
const input = { locale: "en-US", meId: "me1", catalog };
const base = { id: ID, date: "2026-11-02" };

function expenseDraft(currency: string, amountText: string) {
	return {
		...newExpenseDraft({ ...base, currency }),
		amountText,
		title: "Ramen",
		categoryId: "food",
	};
}

const WRITES: Record<string, () => PendingWrite> = {
	"a yen expense": () =>
		buildExpenseWrite(expenseDraft("JPY", "1,500"), input) as PendingWrite,
	"a dinar split": () =>
		buildExpenseWrite(
			{
				...expenseDraft("KWD", "12.345"),
				withKeys: ["user:lucia1"],
			},
			input,
		) as PendingWrite,
	"yen income": () =>
		buildIncomeWrite(
			{
				...newIncomeDraft({
					...base,
					currency: "JPY",
					usePlan: false,
				}),
				amountText: "250,000",
				source: "Acme",
			},
			{ locale: "en-US", hasBudget: false },
		) as PendingWrite,
	"a yen to dinar transfer": () =>
		buildTransferWrite(
			{
				...newTransferDraft({
					...base,
					currency: "JPY",
					places: catalog.places,
				}),
				toId: "dinar",
				amountText: "100,000",
				receivedText: "216.789",
			},
			{ locale: "en-US", places: catalog.places },
		) as PendingWrite,
};

type Call = { route: string; input: unknown; key?: string };
type Init = { context?: { idempotencyKey?: string } };

/**
 * A fake API that logs every call. `fail` makes a route throw (with a status
 * when the server answers, without one when there is no answer).
 */
function fakeApi(fail: Record<string, unknown> = {}) {
	const calls: Call[] = [];
	const route =
		(name: string, answer: unknown = { undo: `tok-${name}` }) =>
		async (body: unknown, init?: Init) => {
			calls.push({
				route: name,
				input: body,
				key: init?.context?.idempotencyKey,
			});
			if (name in fail) throw fail[name];
			return answer;
		};
	const family = (name: string) => ({
		create: route(`${name}.create`),
		update: route(`${name}.update`),
		undo: route(`${name}.undo`, {}),
	});
	const api = {
		expenses: family("expenses"),
		"shared-expenses": family("shared-expenses"),
		income: family("income"),
		transfers: family("transfers"),
	} as unknown as RetrospendClient;
	return { api, calls };
}

const NO_ANSWER = new Error("Network request failed");
const refused = (status: number) => Object.assign(new Error("no"), { status });

function stubForm(editing = false) {
	const form = {
		editing,
		setTried: jest.fn(),
		setDrafts: jest.fn(),
		fresh: jest.fn(() => "a fresh draft"),
		setStep: jest.fn(),
	};
	return { form, asForm: form as unknown as EntryForm };
}

async function setup(
	write: PendingWrite | null,
	options: {
		editing?: boolean;
		blocked?: boolean;
		api?: RetrospendClient;
	} = {},
) {
	const { form, asForm } = stubForm(options.editing);
	const onDone = jest.fn();
	if (options.api) world.api = options.api;
	const hook = await renderHook(
		(props: { write: PendingWrite | null; blocked: boolean }) =>
			useEntrySave({
				form: asForm,
				write: props.write,
				blocked: props.blocked,
				onDone,
			}),
		{ write, blocked: options.blocked ?? false },
	);
	const add = () =>
		act(async () => {
			await hook.result.current.add();
		});
	return { ...hook, form, onDone, add };
}

let changes: jest.Mock;
let unsubscribe: () => void;
beforeEach(() => {
	forgetUndoTokens();
	world.nextId = (() => {
		let n = 0;
		return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
	})();
	changes = jest.fn();
	unsubscribe = subscribeEntryChanges(changes);
});
afterEach(() => unsubscribe());

describe("Add", () => {
	describe.each(Object.entries(WRITES))("%s", (_name, build) => {
		it("sends the built body under its id and ends in an Added toast with Undo", async () => {
			const write = build();
			const { api, calls } = fakeApi();
			const { add, onDone, form } = await setup(write, { api });
			await add();

			expect(calls).toHaveLength(1);
			expect(calls[0]).toMatchObject({
				route: `${write.entity}.create`,
				input: write.body,
				key: ID,
			});
			expect(lastToast().message).toBe(`Added ${write.label}`);
			expect(lastToast().undo?.label).toBe("Undo");
			expect(changes).toHaveBeenCalled();
			// The composer starts over for the next one and closes.
			expect(form.setTried).toHaveBeenNthCalledWith(1, true);
			expect(form.setDrafts).toHaveBeenCalledWith("a fresh draft");
			expect(form.setTried).toHaveBeenLastCalledWith(false);
			expect(form.setStep).toHaveBeenCalledWith("quick");
			expect(onDone).toHaveBeenCalledTimes(1);
			expect(await world.local.outbox.all()).toHaveLength(0);
		});

		it("undoes through the family's own route with the server's token", async () => {
			const write = build();
			const { api, calls } = fakeApi();
			const { add } = await setup(write, { api });
			await add();
			const before = changes.mock.calls.length;
			await act(async () => {
				await lastToast().undo?.onUndo();
			});

			const undo = calls.find((c) => c.route === `${write.entity}.undo`);
			expect(undo?.input).toEqual({ token: `tok-${write.entity}.create` });
			expect(undo?.key).toBe(`${ID}-undo`);
			expect(lastToast().message).toBe(`Removed ${write.label}`);
			expect(lastToast().undo).toBeUndefined();
			expect(changes.mock.calls.length).toBeGreaterThan(before);
		});

		it("says Undo failed when the server refuses the undo", async () => {
			const write = build();
			const { api, calls } = fakeApi({
				[`${write.entity}.undo`]: refused(409),
			});
			const { add } = await setup(write, { api });
			await add();
			await act(async () => {
				await lastToast().undo?.onUndo();
			});
			expect(calls.some((c) => c.route === `${write.entity}.undo`)).toBe(true);
			expect(lastToast().message).toBe(
				"Couldn't undo. Try again from Activity.",
			);
		});
	});

	it("says Undo failed when there is no connection for the undo", async () => {
		const write = WRITES["a yen expense"]?.() as PendingWrite;
		const { api } = fakeApi({ "expenses.undo": NO_ANSWER });
		const { add } = await setup(write, { api });
		await add();
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		expect(lastToast().message).toBe("Couldn't undo. Try again from Activity.");
	});

	it("keeps the write on the phone when the server can not be reached", async () => {
		const write = WRITES["a yen expense"]?.() as PendingWrite;
		const { api } = fakeApi({ "expenses.create": NO_ANSWER });
		const { add, onDone } = await setup(write, { api });
		await add();

		expect(lastToast().message).toBe(
			`Saved ${write.label} on this phone. It syncs when you're online.`,
		);
		expect(lastToast().undo?.label).toBe("Undo");
		expect(onDone).toHaveBeenCalled();
		const waiting = await world.local.outbox.all();
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({
			clientId: ID,
			entity: "expenses",
			payload: write.body,
		});
	});

	it("does not take a queued write back while still offline", async () => {
		const write = WRITES["a yen expense"]?.() as PendingWrite;
		const { api, calls } = fakeApi({ "expenses.create": NO_ANSWER });
		const { add } = await setup(write, { api });
		await add();
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		// The send may have reached the server: it is never deleted unseen.
		expect(lastToast().message).toBe("Couldn't undo. Try again from Activity.");
		expect(await world.local.outbox.all()).toHaveLength(1);
		expect(calls.some((c) => c.route === "expenses.undo")).toBe(false);
	});

	it("parks a write the server refuses, with no Undo", async () => {
		const write = WRITES["a dinar split"]?.() as PendingWrite;
		const { api } = fakeApi({ "shared-expenses.create": refused(422) });
		const { add, onDone } = await setup(write, { api });
		await add();

		expect(lastToast().message).toBe(
			`Couldn't add ${write.label}. It stays on this phone.`,
		);
		expect(lastToast().undo).toBeUndefined();
		expect(onDone).toHaveBeenCalled();
		const parked = await world.local.outbox.all();
		expect(parked).toHaveLength(1);
		expect(parked[0]?.state).toBe("conflict");
	});

	it("does nothing without a write, a connection, or while blocked", async () => {
		const write = WRITES["a yen expense"]?.() as PendingWrite;
		const { api, calls } = fakeApi();

		const none = await setup(null, { api });
		await none.add();
		expect(none.form.setTried).toHaveBeenCalledWith(true);
		expect(none.onDone).not.toHaveBeenCalled();

		const blocked = await setup(write, { api, blocked: true });
		await blocked.add();
		expect(blocked.onDone).not.toHaveBeenCalled();

		world.api = undefined;
		const offline = await setup(write);
		await offline.add();
		expect(offline.onDone).not.toHaveBeenCalled();

		expect(calls).toHaveLength(0);
		expect(world.toast.show).not.toHaveBeenCalled();
		expect(await world.local.outbox.all()).toHaveLength(0);
	});

	it("is busy while the send is in flight, and a second tap does not write twice", async () => {
		const write = WRITES["a yen expense"]?.() as PendingWrite;
		const { api, calls } = fakeApi();
		const slow = api.expenses.create;
		let release!: () => void;
		(api.expenses as { create: unknown }).create = (
			body: unknown,
			init: Init,
		) =>
			new Promise((resolve) => {
				release = () => resolve(slow(body as never, init as never));
			});
		const { add, result } = await setup(write, { api });
		let first!: Promise<void>;
		await act(async () => {
			first = result.current.add() as Promise<void>;
		});
		expect(result.current.busy).toBe(true);
		await add();
		await act(async () => {
			release();
			await first;
		});
		expect(result.current.busy).toBe(false);
		expect(calls.filter((c) => c.route === "expenses.create")).toHaveLength(1);
	});
});

describe("Save an edit", () => {
	const editOf = (currency: string, amountText: string): PendingWrite => {
		const d = {
			...newExpenseDraft({ ...base, currency }),
			amountText,
			title: "Ramen",
			categoryId: "food",
			editing: {
				source: "personal" as const,
				currency,
				rateType: null,
				home: null,
				split: null,
				projectId: null,
				category: null,
			},
		};
		return buildExpenseUpdate(d, input) as PendingWrite;
	};

	it("sends the edit at once, never through the outbox, and ends in a Saved toast with Undo", async () => {
		const write = editOf("KWD", "12.345");
		const { api, calls } = fakeApi();
		const { add, onDone } = await setup(write, { api, editing: true });
		await add();

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			route: "expenses.update",
			input: { amount: "12.345", currency: "KWD" },
		});
		expect(lastToast().message).toBe("Saved Ramen");
		expect(lastToast().undo?.label).toBe("Undo");
		expect(changes).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		expect(await world.local.outbox.all()).toHaveLength(0);
	});

	it("writes a yen edit in whole units", async () => {
		const { api, calls } = fakeApi();
		const { add } = await setup(editOf("JPY", "1,500"), { api, editing: true });
		await add();
		expect(calls[0]?.input).toMatchObject({ amount: "1500", currency: "JPY" });
	});

	it("undoes by the token of the edit and says Restored", async () => {
		const { api, calls } = fakeApi();
		const { add } = await setup(editOf("JPY", "1,500"), { api, editing: true });
		await add();
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		const undo = calls.find((c) => c.route === "expenses.undo");
		expect(undo?.input).toEqual({ token: "tok-expenses.update" });
		expect(lastToast().message).toBe("Restored Ramen");
	});

	it("says Undo failed when the undo of an edit does not go through", async () => {
		const { api } = fakeApi({ "expenses.undo": refused(409) });
		const { add } = await setup(editOf("JPY", "1,500"), { api, editing: true });
		await add();
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		expect(lastToast().message).toBe("Couldn't undo. Try again from Activity.");
	});

	it("routes a split's edit to shared expenses and undoes there", async () => {
		const write: PendingWrite = {
			entity: "shared-expenses",
			kind: "update",
			label: "Dinner",
			body: { id: ID, amount: "12.345", currency: "KWD" },
		};
		const { api, calls } = fakeApi();
		const { add } = await setup(write, { api, editing: true });
		await add();
		expect(calls[0]?.route).toBe("shared-expenses.update");
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		expect(calls.at(-1)).toMatchObject({
			route: "shared-expenses.undo",
			input: { token: "tok-shared-expenses.update" },
		});
	});

	it("stays open and says so when offline, or refused", async () => {
		const offline = fakeApi({ "expenses.update": NO_ANSWER });
		const a = await setup(editOf("JPY", "1,500"), {
			api: offline.api,
			editing: true,
		});
		await a.add();
		expect(lastToast().message).toBe(
			"You're offline. Editing needs a connection.",
		);
		expect(a.onDone).not.toHaveBeenCalled();

		const locked = fakeApi({ "expenses.update": refused(409) });
		const b = await setup(editOf("JPY", "1,500"), {
			api: locked.api,
			editing: true,
		});
		await b.add();
		expect(lastToast().message).toBe(
			"Couldn't save this change. It may be locked.",
		);
		expect(b.onDone).not.toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
	});

	it("retries the same edit under the same key, and a changed edit under a new one", async () => {
		const { api, calls } = fakeApi({ "expenses.update": NO_ANSWER });
		const { add, rerender } = await setup(editOf("JPY", "1,500"), {
			api,
			editing: true,
		});
		await add();
		await add();
		expect(calls).toHaveLength(2);
		expect(calls[1]?.key).toBe(calls[0]?.key);
		expect(calls[0]?.key).toBeTruthy();

		await rerender({ write: editOf("JPY", "1,800"), blocked: false });
		await add();
		expect(calls[2]?.key).not.toBe(calls[0]?.key);
	});

	it("does nothing while blocked", async () => {
		const { api, calls } = fakeApi();
		const { add, onDone } = await setup(editOf("JPY", "1,500"), {
			api,
			editing: true,
			blocked: true,
		});
		await add();
		expect(calls).toHaveLength(0);
		expect(onDone).not.toHaveBeenCalled();
	});
});

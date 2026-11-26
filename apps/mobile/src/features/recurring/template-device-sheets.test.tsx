import type { RetrospendClient } from "@retrospend/api-client";
import type { ActivityItem } from "@/features/activity/source";
import { forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import {
	disabled,
	lastToast,
	mount,
	press,
	pressAsync,
	wait,
	words,
	world,
} from "../../../test/harness";
import { DeleteRecurringSheet } from "./DeleteRecurringSheet";
import { ItemSheet } from "./ItemSheet";
import { MakeRecurringSheet } from "./MakeRecurringSheet";
import type { RecurringItem } from "./source";

// The template sheets under the dev flag, with real presses: Make recurring
// and Pause or auto-pay are booked on the device and queued (a create under
// its client id, an edit stamped with the template's version), offline they
// wait on the phone, Undo takes each back, and Delete stays online and says
// "Sync first" while this phone holds a write to the template. With the flag
// off, or for income, the write goes straight to API v1.
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));
jest.mock("@/ui/Sheet", () => {
	const { Pressable } = require("react-native");
	return {
		Sheet: ({
			visible,
			children,
			footer,
			edit,
		}: {
			visible?: boolean;
			children?: unknown;
			footer?: unknown;
			edit?: { label: string; onPress: () => void };
		}) =>
			visible === false
				? null
				: ([
						edit ? (
							<Pressable
								accessibilityLabel={edit.label}
								key="edit"
								onPress={edit.onPress}
							/>
						) : null,
						children,
						footer,
					] as never),
	};
});
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);
jest.mock("@/ui/SwitchRow", () => {
	const { Pressable } = require("react-native");
	return {
		SwitchRow: ({
			label,
			value,
			onChange,
		}: {
			label: string;
			value: boolean;
			onChange: (next: boolean) => void;
		}) => (
			<Pressable accessibilityLabel={label} onPress={() => onChange(!value)} />
		),
	};
});

const STAMP = "2026-10-20T10:00:00.000Z";
const MADE = "2026-11-02T10:00:00.000Z";
const AFTER = "2026-11-02T10:00:05.000Z";
const AFTER_BACK = "2026-11-02T10:00:09.000Z";

const item = {
	id: "rec-netflix",
	title: "Netflix",
	direction: "out",
	paused: false,
	autoPay: true,
	frequency: "monthly",
	next: "2026-12-01",
	amount: { minor: 1599, currency: "USD" },
	updatedAt: STAMP,
} as unknown as RecurringItem;

const expense = {
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Streamly",
	category: null,
	amount: { minor: 1000, currency: "USD" },
	sortKey: 1000,
	project: null,
	date: "2026-01-31",
	mine: true,
	locked: false,
	canEdit: true,
} as unknown as ActivityItem;

const network = () => new Error("Network request failed");
const dry = { changes: [], unchanged: [], unavailable: [] };

function setup() {
	const recurring = {
		create: jest.fn(async (input: { id: string }) => ({
			id: input.id,
			updatedAt: MADE,
		})),
		update: jest.fn(async (input: { id: string }) => ({
			id: input.id,
			updatedAt: AFTER,
		})),
		delete: jest.fn(async (_input: unknown) => ({ ok: true, undo: "tok-d" })),
		previewDelete: jest.fn(async () => dry),
	};
	const writes = {
		book: jest.fn(
			async (): Promise<{
				bookedAt: number;
				changes: never[];
				changed: never[];
				base: string | null;
			} | null> => ({ bookedAt: 1, changes: [], changed: [], base: STAMP }),
		),
		comparePreview: jest.fn(async () => undefined),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
	};
	world.api = { recurring } as unknown as RetrospendClient;
	mockWrites.mockReturnValue(writes);
	return { recurring, writes, outbox: world.local.outbox };
}

beforeEach(() => {
	mockWrites.mockReset().mockReturnValue(null);
	forgetUndoTokens();
	forgetSent();
});

async function openMake() {
	const onDone = jest.fn();
	const onClose = jest.fn();
	const tree = await mount(
		<MakeRecurringSheet
			item={expense}
			onClose={onClose}
			onDone={onDone}
			visible
		/>,
	);
	return { tree, onDone, onClose };
}

describe("Make recurring under the dev flag", () => {
	it("books the template on the device and sends one create under its client id", async () => {
		const { recurring, writes } = setup();
		const { tree, onClose, onDone } = await openMake();
		await pressAsync(tree, "Make recurring");
		const [body, init] = recurring.create.mock.calls[0] as unknown as [
			Record<string, unknown>,
			{ context: { idempotencyKey: string } },
		];
		const id = init.context.idempotencyKey;
		expect(id).toMatch(/^00000000-0000-4000-8000-/);
		// The key is the template's id; the day is the first of the month, anchored on the 31st.
		expect(body).toEqual({
			id,
			name: "Streamly",
			amount: "10.00",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: "2026-02-28",
			anchorDay: 31,
			autoPay: false,
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "templateCreate",
			body,
		});
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		expect(lastToast().message).toBe("Streamly now repeats monthly");
	});

	it("Undo deletes the new template under the undo key", async () => {
		const { recurring } = setup();
		const { tree } = await openMake();
		await pressAsync(tree, "Make recurring");
		const [{ id }] = recurring.create.mock.calls[0] as unknown as [
			{ id: string },
		];
		await lastToast().undo?.onUndo();
		expect(recurring.delete).toHaveBeenCalledWith(
			{ id },
			expect.objectContaining({
				context: { idempotencyKey: `${id}-undo-1` },
			}),
		);
		expect(await world.local.outbox.snapshot()).toEqual({
			open: [],
			acked: [],
		});
	});

	it("waits on the phone when offline: one create entry whose id is the template's id", async () => {
		const { recurring } = setup();
		recurring.create.mockRejectedValue(network());
		const { tree } = await openMake();
		await pressAsync(tree, "Make recurring");
		const entries = await world.local.outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "recurring",
			kind: "create",
			baseVersion: null,
			payload: { name: "Streamly", anchorDay: 31 },
		});
		expect(entries[0]?.targetId).toBe(entries[0]?.clientId);
		expect(lastToast().message).toBe(
			"Saved Streamly on this phone. It syncs when you're online.",
		);
	});

	it("a refused create stays parked on the phone and offers no Undo", async () => {
		const { recurring } = setup();
		recurring.create.mockRejectedValue(
			Object.assign(new Error("no"), { status: 400, code: "bad_request" }),
		);
		const { tree } = await openMake();
		await pressAsync(tree, "Make recurring");
		expect(lastToast().message).toBe(
			"Couldn't send Streamly. It stays on this phone.",
		);
		expect(lastToast().undo).toBeUndefined();
		expect((await world.local.outbox.all())[0]?.state).toBe("conflict");
	});

	it("flag off: the plain create, no engine call, nothing queued", async () => {
		const { recurring, writes } = setup();
		mockWrites.mockReturnValue(null);
		const { tree } = await openMake();
		await pressAsync(tree, "Make recurring");
		expect(recurring.create).toHaveBeenCalledTimes(1);
		expect(writes.book).not.toHaveBeenCalled();
		expect(await world.local.outbox.snapshot()).toEqual({
			open: [],
			acked: [],
		});
	});
});

async function openItem(over: Partial<RecurringItem> = {}) {
	const onDone = jest.fn();
	const tree = await mount(
		<ItemSheet
			item={{ ...item, ...over } as RecurringItem}
			onClose={jest.fn()}
			onDelete={jest.fn()}
			onDone={onDone}
			visible
		/>,
	);
	press(tree, "Edit");
	return { tree, onDone };
}

describe("Pause and auto-pay under the dev flag", () => {
	it("books the edit on the device and sends one PATCH stamped with the version the screen read", async () => {
		const { recurring, writes } = setup();
		const { tree, onDone } = await openItem();
		await pressAsync(tree, "Pause");
		expect(writes.book).toHaveBeenCalledWith({
			kind: "templateUpdate",
			body: { id: "rec-netflix", paused: true },
		});
		const [body, init] = recurring.update.mock.calls[0] as unknown as [
			unknown,
			{ context: { idempotencyKey: string } },
		];
		expect(body).toEqual({
			id: "rec-netflix",
			paused: true,
			expectedUpdatedAt: STAMP,
		});
		expect(init.context.idempotencyKey).toMatch(/^00000000-0000-4000-8000-/);
		expect(onDone).toHaveBeenCalled();
		expect(lastToast().message).toBe("Netflix paused");
	});

	it("waits on the phone when offline, stamped and keyed, with the name kept for Sync issues only", async () => {
		const { recurring } = setup();
		recurring.update.mockRejectedValue(network());
		const { tree } = await openItem();
		await pressAsync(tree, "Record automatically");
		const entries = await world.local.outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "recurring",
			kind: "update",
			targetId: "rec-netflix",
			baseVersion: STAMP,
			payload: { autoPay: false, title: "Netflix" },
		});
		expect(lastToast().message).toBe(
			"Saved Netflix on this phone. It syncs when you're online.",
		);
	});

	it("Undo of a sent pause writes the old value back over the template as it is now", async () => {
		const { recurring, writes } = setup();
		writes.book
			.mockResolvedValueOnce({
				bookedAt: 1,
				changes: [],
				changed: [],
				base: STAMP,
			})
			.mockResolvedValueOnce({
				bookedAt: 2,
				changes: [],
				changed: [],
				base: AFTER,
			});
		recurring.update
			.mockResolvedValueOnce({ id: "rec-netflix", updatedAt: AFTER })
			.mockResolvedValueOnce({ id: "rec-netflix", updatedAt: AFTER_BACK });
		const { tree } = await openItem();
		await pressAsync(tree, "Pause");
		await lastToast().undo?.onUndo();
		expect(recurring.update).toHaveBeenCalledTimes(2);
		expect(recurring.update.mock.calls[1]?.[0]).toEqual({
			id: "rec-netflix",
			paused: false,
			expectedUpdatedAt: AFTER,
		});
	});

	it("Undo of a pause whose send has no answer says it is still sending, sends nothing and leaves it queued", async () => {
		const { recurring } = setup();
		recurring.update.mockRejectedValue(network());
		const { tree } = await openItem();
		await pressAsync(tree, "Pause");
		await lastToast().undo?.onUndo();
		expect(lastToast().message).toBe(
			"Netflix is still sending. Try again in a moment.",
		);
		expect(recurring.update).toHaveBeenCalledTimes(1);
		const entries = await world.local.outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.payload).toMatchObject({ paused: true });
	});

	it("an earlier write to the template that is parked blocks the edit: nothing is booked or sent", async () => {
		const { recurring, writes } = setup();
		await world.local.outbox.enqueue({
			clientId: "earlier",
			entity: "recurring",
			kind: "update",
			targetId: "rec-netflix",
			baseVersion: STAMP,
			payload: { paused: true },
		});
		await world.local.outbox.markConflict("earlier", "recurring_changed");
		const { tree } = await openItem();
		await pressAsync(tree, "Pause");
		expect(writes.book).not.toHaveBeenCalled();
		expect(recurring.update).not.toHaveBeenCalled();
		expect(lastToast().message).toBe("Fix Netflix under Couldn't sync first.");
	});

	it("a template the device has no version of, and the screen none either, is never sent unchecked", async () => {
		const { recurring, writes } = setup();
		writes.book.mockResolvedValue(null);
		const { tree } = await openItem({ updatedAt: null } as never);
		await pressAsync(tree, "Pause");
		expect(recurring.update).not.toHaveBeenCalled();
		expect(await world.local.outbox.all()).toEqual([]);
		expect(lastToast().message).toBe(
			"Couldn't read Netflix. Try again in a moment.",
		);
	});

	it("income and the flag off go straight to API v1", async () => {
		const { recurring, writes } = setup();
		const income = await openItem({ direction: "in" } as never);
		await pressAsync(income.tree, "Pause");
		mockWrites.mockReturnValue(null);
		const off = await openItem();
		await pressAsync(off.tree, "Pause");
		expect(recurring.update).toHaveBeenCalledTimes(2);
		expect(recurring.update.mock.calls[0]?.[0]).toEqual({
			id: "rec-netflix",
			paused: true,
		});
		expect(writes.book).not.toHaveBeenCalled();
		expect(await world.local.outbox.snapshot()).toEqual({
			open: [],
			acked: [],
		});
	});
});

async function openDelete(over: Partial<RecurringItem> = {}) {
	const tree = await mount(
		<DeleteRecurringSheet
			item={{ ...item, ...over } as RecurringItem}
			onClose={jest.fn()}
			onDone={jest.fn()}
			visible
		/>,
	);
	await wait(400);
	return tree;
}

const waiting = (clientId: string, target = "rec-netflix") =>
	world.local.outbox.enqueue({
		clientId,
		entity: "recurring",
		kind: "update",
		targetId: target,
		baseVersion: STAMP,
		payload: { paused: true },
		device: { bookedAt: 1, changes: [], changed: [] },
	});

describe("Delete under the dev flag", () => {
	it("stays online: the dry run and the plain delete, nothing queued", async () => {
		const { recurring } = setup();
		const tree = await openDelete();
		expect(disabled(tree, "Delete recurring expense")).toBe(false);
		await pressAsync(tree, "Delete recurring expense");
		expect(recurring.delete).toHaveBeenCalledTimes(1);
		expect(recurring.delete.mock.calls[0]?.[0]).toEqual({ id: "rec-netflix" });
		expect(await world.local.outbox.all()).toEqual([]);
	});

	it("says Sync first and deletes nothing while a write to it waits on the phone", async () => {
		const { recurring } = setup();
		await waiting("w1");
		const tree = await openDelete();
		expect(words(tree)).toContain(
			"Sync first: some changes haven't synced yet.",
		);
		expect(disabled(tree, "Delete recurring expense")).toBe(true);
		expect(recurring.previewDelete).not.toHaveBeenCalled();
		expect(recurring.delete).not.toHaveBeenCalled();
	});

	it("says it for a parked write, and for one the server took that no pull has shown back", async () => {
		setup();
		await waiting("w1");
		await world.local.outbox.markConflict("w1", "recurring_changed");
		expect(words(await openDelete())).toContain("Sync first");
		await world.local.outbox.discard("w1");
		await waiting("w2");
		await world.local.outbox.markSending("w2");
		await world.local.outbox.markSent("w2", { version: AFTER, pull: 1 });
		expect((await world.local.outbox.snapshot()).acked).toHaveLength(1);
		expect(words(await openDelete())).toContain("Sync first");
	});

	it("an outbox that cannot be read counts as a write waiting: Sync first, never a delete", async () => {
		const { recurring } = setup();
		jest
			.spyOn(world.local.outbox, "snapshot")
			.mockRejectedValue(new Error("unreadable"));
		const tree = await openDelete();
		expect(words(tree)).toContain("Sync first");
		expect(disabled(tree, "Delete recurring expense")).toBe(true);
		expect(recurring.delete).not.toHaveBeenCalled();
	});

	it("a write to another template does not stand in the way", async () => {
		setup();
		await waiting("w1", "rec-other");
		const tree = await openDelete();
		expect(words(tree)).not.toContain("Sync first");
		expect(disabled(tree, "Delete recurring expense")).toBe(false);
	});

	it("checks again at the write: a change queued after the sheet opened stops the delete", async () => {
		const { recurring } = setup();
		const tree = await openDelete();
		await waiting("late");
		await pressAsync(tree, "Delete recurring expense");
		expect(recurring.delete).not.toHaveBeenCalled();
		expect(words(tree)).toContain("Couldn't delete it. Try again.");
	});

	it("flag off: no outbox is read and the delete goes ahead", async () => {
		const { recurring } = setup();
		mockWrites.mockReturnValue(null);
		await waiting("w1");
		const tree = await openDelete();
		expect(words(tree)).not.toContain("Sync first");
		await pressAsync(tree, "Delete recurring expense");
		expect(recurring.delete).toHaveBeenCalledTimes(1);
	});
});

import type { RetrospendClient } from "@retrospend/api-client";
import { forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import {
	disabled,
	lastToast,
	mount,
	press,
	pressAsync,
	type,
	wait,
	world,
} from "../../../test/harness";
import { AccountSheet } from "./AccountSheet";
import type { Account } from "./source";

// Add account and Edit account under the dev flag and the server's
// wealthWrites, with real presses: the device books the write and queues it
// (an edit with the version and balance of the account it read), offline it
// waits on the phone, and Undo takes it back. With either switch off the
// write goes straight to API v1 as ever.
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => mockWrites(),
	deviceFlagOn: () => mockWrites() !== null,
}));
jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);
jest.mock("@/ui/SwitchRow", () => ({ SwitchRow: () => null }));
jest.mock("@/ui/TextField", () => {
	const { Pressable } = require("react-native");
	return {
		FieldLabel: () => null,
		TextField: ({ label, onChangeText }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				onChangeText={onChangeText}
			/>
		),
	};
});
jest.mock("@/ui/Picker", () => ({
	Picker: () => null,
	WheelField: () => null,
}));
jest.mock("@/ui/CurrencyPicker", () => ({ CurrencyPicker: () => null }));
jest.mock("@/features/entry/currencyChoices", () => ({
	useCurrencyChoices: (home: string) => ({
		currencies: [home],
		yours: [home],
		recent: [],
	}),
}));

const ID = "acct-galicia";
const ars = (minor: number) => ({ minor, currency: "ARS" });
const base = {
	id: ID,
	name: "Galicia",
	type: "CASH",
	currency: "ARS",
	value: null,
	inBudget: true,
	isLiquid: true,
	rateType: null,
	closedAt: null,
	interestRate: null,
	minimumPayment: null,
	dueDay: null,
	updatedAt: "2026-10-01T00:00:00.000Z",
};
// What the list showed (version 4), and what the server holds now (version 6).
const listed = {
	...base,
	balance: ars(10_000),
	version: 4,
} as unknown as Account;
const current = { ...base, balance: ars(25_000), version: 6 };
const network = () => new Error("Network request failed");
const dry = { changes: [], unchanged: [], unavailable: [] };

function setup({ wealthWrites = true }: { wealthWrites?: boolean } = {}) {
	const accounts = {
		get: jest.fn(async (..._a: unknown[]): Promise<unknown> => current),
		previewCreate: jest.fn(async (..._a: unknown[]) => dry),
		previewUpdate: jest.fn(async (..._a: unknown[]) => dry),
		create: jest.fn(async (..._a: unknown[]) => ({
			undo: "tok-create",
			result: { version: 0 },
		})),
		update: jest.fn(async (..._a: unknown[]) => ({
			undo: "tok-update",
			result: { version: 7, legId: null, rateTypeId: null },
		})),
		undo: jest.fn(async (..._a: unknown[]) => ({ result: {}, redo: null })),
	};
	const platform = {
		serverInfo: jest.fn(async (..._a: unknown[]) => ({
			features: { wealthWrites },
		})),
	};
	const writes = {
		book: jest.fn(async (..._a: unknown[]) => ({
			bookedAt: 1,
			changes: [],
			changed: [],
			base: null,
			accountBase: { version: 6, balance: "250.00" },
		})),
		comparePreview: jest.fn(async (..._a: unknown[]) => undefined),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
		overlayAccount: jest.fn(async (..._a: unknown[]) => null),
	};
	world.api = { accounts, platform } as unknown as RetrospendClient;
	mockWrites.mockReturnValue(writes);
	return { accounts, platform, writes, outbox: world.local.outbox };
}

// The test provider has no time zone, which use-intl reports on every date.
const realError = console.error;
beforeAll(() => {
	jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		if (String(args[0]).includes("ENVIRONMENT_FALLBACK")) return;
		realError(...args);
	});
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
	mockWrites.mockReset().mockReturnValue(null);
	forgetUndoTokens();
	forgetSent();
	const { Dimensions } = require("react-native");
	const now = Dimensions.get("window");
	Dimensions.set({
		window: { ...now, fontScale: 1 },
		screen: { ...now, fontScale: 1 },
	});
});

async function open(account: Account | null) {
	const onDone = jest.fn();
	const onClose = jest.fn();
	const tree = await mount(
		<AccountSheet
			account={account}
			catalog={[{ code: "ARS", rateTypes: [] }] as never}
			home="ARS"
			onClose={onClose}
			onDone={onDone}
			visible
		/>,
	);
	await wait(400);
	return { tree, onDone, onClose };
}

async function fillNew(tree: Awaited<ReturnType<typeof open>>["tree"]) {
	type(tree, "Name", "Cash");
	for (const key of ["5", "0", "0"]) press(tree, key);
	await wait(400);
}

describe("Add account under the dev flag", () => {
	it("books the account under its own id and sends one create with that id", async () => {
		const { accounts, writes } = setup();
		const { tree, onClose, onDone } = await open(null);
		await fillNew(tree);
		await pressAsync(tree, "Add account");
		expect(writes.book).toHaveBeenCalledTimes(1);
		const [op] = writes.book.mock.calls[0] as unknown as [
			{ kind: string; body: { id: string; name: string; balance: string } },
		];
		expect(op.kind).toBe("accountCreate");
		expect(op.body).toMatchObject({ name: "Cash", balance: "500.00" });
		expect(accounts.create).toHaveBeenCalledTimes(1);
		const [sent, init] = accounts.create.mock.calls[0] as unknown as [
			{ id: string; title?: string },
			{ context: { idempotencyKey: string } },
		];
		// The entry's client id is the account's id and the idempotency key.
		expect(sent.id).toBe(op.body.id);
		expect(init.context.idempotencyKey).toBe(op.body.id);
		// The name kept for Sync issues is never sent.
		expect(sent).not.toHaveProperty("title");
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		expect(lastToast().message).toBe("Cash added");
	});

	it("offline: Save waits on the phone and the entry carries the account's id", async () => {
		const { accounts, outbox } = setup();
		accounts.previewCreate.mockRejectedValue(network());
		accounts.create.mockRejectedValue(network());
		const { tree } = await open(null);
		await fillNew(tree);
		expect(disabled(tree, "Add account")).toBe(false);
		await pressAsync(tree, "Add account");
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "accounts",
			kind: "create",
			baseVersion: null,
			payload: { name: "Cash", balance: "500.00" },
		});
		expect(entries[0]?.targetId).toBe(entries[0]?.clientId);
		expect(lastToast().message).toBe(
			"Saved Cash on this phone. It syncs when you're online.",
		);
	});

	it("Undo of a sent account goes through the server's token", async () => {
		const { accounts } = setup();
		const { tree } = await open(null);
		await fillNew(tree);
		await pressAsync(tree, "Add account");
		await lastToast().undo?.onUndo();
		expect(accounts.undo).toHaveBeenCalledWith(
			{ token: "tok-create" },
			expect.anything(),
		);
	});

	it("the server's switch off: the plain create, nothing queued", async () => {
		const { accounts, writes, outbox } = setup({ wealthWrites: false });
		const { tree } = await open(null);
		await fillNew(tree);
		await pressAsync(tree, "Add account");
		expect(accounts.create).toHaveBeenCalledTimes(1);
		expect(writes.book).not.toHaveBeenCalled();
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		expect(lastToast().message).toBe("Cash added");
	});

	it("the dev flag off: the plain create and no question to the server", async () => {
		const { accounts, platform } = setup();
		mockWrites.mockReturnValue(null);
		const { tree } = await open(null);
		await fillNew(tree);
		await pressAsync(tree, "Add account");
		expect(accounts.create).toHaveBeenCalledTimes(1);
		expect(platform.serverInfo).not.toHaveBeenCalled();
	});
});

describe("Edit account under the dev flag", () => {
	it("sends one update checked against the version and balance of the fresh read", async () => {
		const { accounts, writes } = setup();
		const { tree } = await open(listed);
		type(tree, "Name", "Galicia main");
		await wait(400);
		await pressAsync(tree, "Save");
		expect(writes.book).toHaveBeenCalledTimes(1);
		expect(accounts.update).toHaveBeenCalledTimes(1);
		expect(accounts.update.mock.calls[0]?.[0]).toMatchObject({
			id: ID,
			name: "Galicia main",
			balance: "250.00",
			expectedVersion: 6,
			expectedBalance: "250.00",
			legId: expect.stringMatching(/^00000000-0000-4000-8000-/),
			rateTypeId: expect.stringMatching(/^00000000-0000-4000-8000-/),
		});
		expect(accounts.update.mock.calls[0]?.[0]).not.toHaveProperty("title");
		expect(lastToast().message).toBe("Galicia main saved");
	});

	it("offline, with the fresh read out of reach, starts from the screen's copy and is checked against its version", async () => {
		const { accounts, outbox } = setup();
		accounts.get.mockRejectedValue(network());
		accounts.previewUpdate.mockRejectedValue(network());
		accounts.update.mockRejectedValue(network());
		const { tree } = await open(listed);
		type(tree, "Name", "Galicia main");
		await wait(400);
		expect(disabled(tree, "Save")).toBe(false);
		await pressAsync(tree, "Save");
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "accounts",
			kind: "update",
			targetId: ID,
			baseVersion: "4",
			payload: {
				name: "Galicia main",
				balance: "100.00",
				expectedBalance: "100.00",
			},
		});
	});

	it("without the device a failed read still keeps Save off", async () => {
		const { accounts } = setup({ wealthWrites: false });
		accounts.get.mockRejectedValue(network());
		const { tree } = await open(listed);
		expect(disabled(tree, "Save")).toBe(true);
	});

	it("the dev flag off: the plain update, no version", async () => {
		const { accounts, writes } = setup();
		mockWrites.mockReturnValue(null);
		const { tree } = await open(listed);
		type(tree, "Name", "Galicia main");
		await wait(400);
		await pressAsync(tree, "Save");
		expect(accounts.update.mock.calls[0]?.[0]).toEqual({
			id: ID,
			name: "Galicia main",
			type: "CASH",
			currency: "ARS",
			balance: "250.00",
			rateType: null,
			isLiquid: true,
			interestRate: null,
			minimumPayment: null,
			dueDay: null,
			inBudget: true,
		});
		expect(writes.book).not.toHaveBeenCalled();
	});
});

import type { RetrospendClient } from "@retrospend/api-client";
import { forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import {
	disabled,
	lastToast,
	mount,
	press,
	pressAsync,
	textOf,
	wait,
	world,
} from "../../../test/harness";
import { CloseAccountSheet } from "./CloseAccountSheet";
import type { Account, CurrencyInfo } from "./source";
import { UpdateBalanceSheet } from "./UpdateBalanceSheet";

// Close, Reopen and Update balance under the dev flag and the server's
// wealthWrites, with real presses: the device books the write and queues it
// with the version and stored balance the sheet showed, offline it waits on
// the phone, Undo takes it out of the outbox (or through the server once it
// was sent). With either switch off the write goes straight to API v1 as ever.
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => mockWrites(),
	deviceFlagOn: () => mockWrites() !== null,
}));
jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);

const ID = "acct-galicia";
const ars = (minor: number) => ({ minor, currency: "ARS" });
const account = {
	id: ID,
	name: "Galicia",
	type: "CASH",
	balance: ars(100_000),
	version: 4,
	closedAt: null,
	rateType: null,
	updatedAt: "2026-10-12T12:00:00.000Z",
} as unknown as Account;
const catalog = [] as unknown as CurrencyInfo[];
const network = () => new Error("Network request failed");
const dry = { changes: [], unchanged: [], unavailable: [] };
/** What the server's dry run of a balance update carries for the sheet. */
const balanceDry = {
	changes: [],
	unchanged: [],
	unavailable: [],
	detail: {
		kind: "account.updateBalance",
		result: {
			before: ars(100_000),
			after: ars(150_000),
			notLogged: ars(50_000),
		},
	},
};

function setup({ wealthWrites = true }: { wealthWrites?: boolean } = {}) {
	const accounts = {
		previewClose: jest.fn(async (..._a: unknown[]) => dry),
		previewReopen: jest.fn(async (..._a: unknown[]) => dry),
		close: jest.fn(async (..._a: unknown[]) => ({
			undo: "tok-close",
			result: { version: 5 },
		})),
		reopen: jest.fn(async (..._a: unknown[]) => ({
			undo: "tok-reopen",
			result: { version: 5 },
		})),
		previewUpdateBalance: jest.fn(async (..._a: unknown[]) => balanceDry),
		updateBalance: jest.fn(async (..._a: unknown[]) => ({
			undo: "tok-balance",
			result: { version: 5 },
		})),
		undo: jest.fn(async (..._a: unknown[]) => ({ result: {}, redo: null })),
	};
	const platform = {
		serverInfo: jest.fn(async (..._a: unknown[]) => ({
			features: { wealthWrites },
		})),
	};
	const writes = {
		book: jest.fn(
			async (
				..._a: unknown[]
			): Promise<{
				bookedAt: number;
				changes: never[];
				changed: never[];
				base: string | null;
				accountBase: { version: number; balance: string };
			} | null> => ({
				bookedAt: 1,
				changes: [],
				changed: [],
				base: null,
				accountBase: { version: 4, balance: "1000.00" },
			}),
		),
		comparePreview: jest.fn(async (..._a: unknown[]) => undefined),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
		overlayAccount: jest.fn(
			async (
				..._a: unknown[]
			): Promise<{
				version: number;
				balance: string;
				closed: boolean;
			} | null> => null,
		),
		storedAccount: jest.fn(
			async (
				..._a: unknown[]
			): Promise<{
				version: number;
				balance: string;
				closed: boolean;
			} | null> => ({ version: 4, balance: "1000.00", closed: false }),
		),
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
	// The jest window is at text scale 2, where the system keyboard stands in
	// for the keypad; the keypad is what these tests press.
	const { Dimensions } = require("react-native");
	const now = Dimensions.get("window");
	Dimensions.set({
		window: { ...now, fontScale: 1 },
		screen: { ...now, fontScale: 1 },
	});
});

async function openClose(reopen = false, over: Partial<Account> = {}) {
	const onDone = jest.fn();
	const onClose = jest.fn();
	const tree = await mount(
		<CloseAccountSheet
			account={{ ...account, ...over } as Account}
			onClose={onClose}
			onDone={onDone}
			reopen={reopen}
			visible
		/>,
	);
	await wait(300);
	return { tree, onDone, onClose };
}

describe("Close account under the dev flag", () => {
	it("books the close on the device and sends one close checked against the version the screen showed", async () => {
		const { accounts, writes } = setup();
		const { tree, onClose, onDone } = await openClose();
		await pressAsync(tree, "Close account");
		expect(writes.book).toHaveBeenCalledWith({
			kind: "accountClose",
			body: { id: ID },
		});
		expect(accounts.close).toHaveBeenCalledTimes(1);
		expect(accounts.close.mock.calls[0]?.[0]).toEqual({
			id: ID,
			expectedVersion: 4,
		});
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		expect(lastToast().message).toBe("Galicia closed");
		expect(lastToast().undo).toBeDefined();
	});

	it("holds the device's preview against the server's dry run", async () => {
		const { writes } = setup();
		await openClose();
		expect(writes.comparePreview).toHaveBeenCalledWith(
			{ kind: "accountClose", body: { id: ID } },
			expect.objectContaining({ changes: [] }),
		);
	});

	it("Undo of a sent close goes through the server's token", async () => {
		const { accounts } = setup();
		const { tree } = await openClose();
		await pressAsync(tree, "Close account");
		await lastToast().undo?.onUndo();
		expect(accounts.undo).toHaveBeenCalledWith(
			{ token: "tok-close" },
			expect.anything(),
		);
	});

	it("offline: Save waits on the phone, the entry is based on the screen's version, and Undo does not drop a write that may have been sent", async () => {
		const { accounts, outbox } = setup();
		accounts.previewClose.mockRejectedValue(network());
		accounts.close.mockRejectedValue(network());
		const { tree } = await openClose();
		// No dry run, yet Save is on: the write is queued.
		expect(disabled(tree, "Close account")).toBe(false);
		await pressAsync(tree, "Close account");
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "accounts",
			kind: "close",
			targetId: ID,
			baseVersion: "4",
			payload: { id: ID, title: "Galicia" },
		});
		expect(lastToast().message).toBe(
			"Saved Galicia on this phone. It syncs when you're online.",
		);
		// A send was tried and got no answer: it may be on the server, so Undo
		// sends it again under the same key and, offline, leaves it queued.
		await lastToast().undo?.onUndo();
		expect(lastToast().message).toBe("Couldn't undo. Try again from Activity.");
		expect(await outbox.all()).toHaveLength(1);
		expect(accounts.undo).not.toHaveBeenCalled();
	});

	it("reopen is its own op and call", async () => {
		const { accounts, writes } = setup();
		const { tree } = await openClose(true, { closedAt: "2026-10-01" } as never);
		await pressAsync(tree, "Reopen account");
		expect(writes.book).toHaveBeenCalledWith({
			kind: "accountReopen",
			body: { id: ID },
		});
		expect(accounts.reopen).toHaveBeenCalledTimes(1);
		expect(accounts.close).not.toHaveBeenCalled();
	});

	it("a server refusal parks it on the phone with no Undo", async () => {
		const { accounts, outbox } = setup();
		accounts.close.mockRejectedValue(
			Object.assign(new Error("changed"), {
				status: 409,
				code: "account_changed",
			}),
		);
		const { tree } = await openClose();
		await pressAsync(tree, "Close account");
		expect(lastToast().message).toBe(
			"Couldn't send Galicia. It stays on this phone.",
		);
		expect(lastToast().undo).toBeUndefined();
		expect((await outbox.all())[0]).toMatchObject({
			state: "conflict",
			lastError: "account_changed",
		});
	});

	it("an earlier parked write to the account blocks a new one with a sentence", async () => {
		const { accounts, outbox } = setup();
		await outbox.enqueue({
			clientId: "k-old",
			entity: "accounts",
			kind: "balance",
			targetId: ID,
			baseVersion: "4",
			payload: { id: ID, balance: "1" },
		});
		await outbox.markConflict("k-old", "account_changed");
		const { tree } = await openClose();
		await pressAsync(tree, "Close account");
		expect(lastToast().message).toBe("Fix Galicia under Couldn't sync first.");
		expect(accounts.close).not.toHaveBeenCalled();
		expect(await outbox.all()).toHaveLength(1);
	});

	it("the server's switch off: the plain close, nothing booked or queued", async () => {
		const { accounts, writes, outbox } = setup({ wealthWrites: false });
		const { tree } = await openClose();
		await pressAsync(tree, "Close account");
		expect(accounts.close).toHaveBeenCalledTimes(1);
		expect(accounts.close.mock.calls[0]?.[0]).toEqual({ id: ID });
		expect(writes.book).not.toHaveBeenCalled();
		expect(writes.comparePreview).not.toHaveBeenCalled();
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		expect(lastToast().message).toBe("Galicia closed");
	});

	it("the dev flag off: the plain close, nothing booked or queued", async () => {
		const { accounts, writes, platform, outbox } = setup();
		mockWrites.mockReturnValue(null);
		const { tree } = await openClose();
		await pressAsync(tree, "Close account");
		expect(accounts.close.mock.calls[0]?.[0]).toEqual({ id: ID });
		expect(writes.book).not.toHaveBeenCalled();
		// The server is not even asked about the switch.
		expect(platform.serverInfo).not.toHaveBeenCalled();
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
	});

	it("a close the device cannot book is written online as before", async () => {
		const { accounts, writes, outbox } = setup();
		writes.book.mockResolvedValue(null);
		const { tree } = await openClose();
		await pressAsync(tree, "Close account");
		expect(accounts.close.mock.calls[0]?.[0]).toEqual({ id: ID });
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
	});
});

async function openBalance() {
	const onDone = jest.fn();
	const onClose = jest.fn();
	const tree = await mount(
		<UpdateBalanceSheet
			account={account}
			catalog={catalog}
			home="ARS"
			onClose={onClose}
			onDone={onDone}
			visible
		/>,
	);
	await wait(100);
	return { tree, onDone, onClose };
}

async function typeBalance(tree: Awaited<ReturnType<typeof mount>>) {
	for (const key of ["1", "5", "0", "0"]) press(tree, key);
	await wait(400);
}

describe("Update balance under the dev flag", () => {
	it("queues the typed balance with the version and balance the sheet showed, and sends it", async () => {
		const { accounts, writes } = setup();
		const { tree, onDone } = await openBalance();
		await typeBalance(tree);
		await pressAsync(tree, "Update balance");
		expect(writes.book).toHaveBeenCalledWith({
			kind: "accountBalance",
			body: {
				id: ID,
				balance: "1500.00",
				legId: expect.stringMatching(/^00000000-0000-4000-8000-/),
				rateTypeId: expect.stringMatching(/^00000000-0000-4000-8000-/),
			},
		});
		expect(accounts.updateBalance).toHaveBeenCalledTimes(1);
		expect(accounts.updateBalance.mock.calls[0]?.[0]).toMatchObject({
			id: ID,
			balance: "1500.00",
			expectedVersion: 4,
			// The balance the screen showed: 1,000.00 ARS in minor units.
			expectedBalance: "1000.00",
		});
		expect(onDone).toHaveBeenCalled();
		expect(lastToast().message.replace(/\s/g, " ")).toBe(
			"Galicia is now ARS 1,500",
		);
	});

	it("shows the device's balance and names it, not the pulled one, when this phone has an unsent write", async () => {
		const { accounts, writes } = setup();
		// Its own queued transfer moved the account: 1,000.00 became 1,200.00.
		writes.overlayAccount.mockResolvedValue({
			version: 99,
			balance: "1200.00000000",
			closed: false,
		});
		const { tree } = await openBalance();
		const shown = textOf(tree.root).replace(/\s/g, " ");
		expect(shown).toContain("Now ARS 1,200");
		expect(shown).not.toContain("Now ARS 1,000");
		await typeBalance(tree);
		await pressAsync(tree, "Update balance");
		expect(accounts.updateBalance.mock.calls[0]?.[0]).toMatchObject({
			// The server's version the screen read, never the device's placeholder.
			expectedVersion: 4,
			expectedBalance: "1200.00000000",
		});
	});

	it("when the server's copy is ahead of the device's, shows and names the screen's balance and version", async () => {
		const { accounts, writes } = setup();
		// Another device moved 1,000 to 1,200 (version 6); the engine still holds version 5.
		writes.storedAccount.mockResolvedValue({
			version: 5,
			balance: "1000.00",
			closed: false,
		});
		writes.overlayAccount.mockResolvedValue({
			version: 5,
			balance: "1000.00",
			closed: false,
		});
		const onDone = jest.fn();
		const tree = await mount(
			<UpdateBalanceSheet
				account={{ ...account, version: 6, balance: ars(120_000) } as Account}
				catalog={catalog}
				home="ARS"
				onClose={jest.fn()}
				onDone={onDone}
				visible
			/>,
		);
		await wait(100);
		const shown = textOf(tree.root).replace(/\s/g, " ");
		expect(shown).toContain("Now ARS 1,200");
		await typeBalance(tree);
		await pressAsync(tree, "Update balance");
		expect(accounts.updateBalance.mock.calls[0]?.[0]).toMatchObject({
			expectedVersion: 6,
			expectedBalance: "1200.00",
		});
	});

	it("offline: Save is on without a dry run and waits on the phone, with the balance the sheet showed", async () => {
		const { accounts, outbox } = setup();
		accounts.previewUpdateBalance.mockRejectedValue(network());
		accounts.updateBalance.mockRejectedValue(network());
		const { tree } = await openBalance();
		await typeBalance(tree);
		expect(disabled(tree, "Update balance")).toBe(false);
		await pressAsync(tree, "Update balance");
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "accounts",
			kind: "balance",
			baseVersion: "4",
			payload: {
				balance: "1500.00",
				expectedBalance: "1000.00",
				title: "Galicia",
			},
		});
		expect(lastToast().message).toBe(
			"Saved Galicia on this phone. It syncs when you're online.",
		);
	});

	it("a server error on the dry run keeps Save off, as without the flag", async () => {
		const { accounts } = setup();
		accounts.previewUpdateBalance.mockRejectedValue(
			Object.assign(new Error("boom"), { status: 500 }),
		);
		const { tree } = await openBalance();
		await typeBalance(tree);
		// A 5xx is a server answer, not a missing connection: only a refusal or silence differs.
		expect(disabled(tree, "Update balance")).toBe(true);
	});

	it("the server's switch off: the plain write, no version or balance, nothing queued", async () => {
		const { accounts, writes, outbox } = setup({ wealthWrites: false });
		const { tree } = await openBalance();
		await typeBalance(tree);
		await pressAsync(tree, "Update balance");
		expect(accounts.updateBalance.mock.calls[0]?.[0]).toEqual({
			id: ID,
			balance: "1500.00",
		});
		expect(writes.book).not.toHaveBeenCalled();
		expect(writes.overlayAccount).not.toHaveBeenCalled();
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		await lastToast().undo?.onUndo();
		expect(accounts.undo).toHaveBeenCalledWith(
			{ token: "tok-balance" },
			expect.anything(),
		);
	});

	it("the dev flag off: the plain write", async () => {
		const { accounts, writes } = setup();
		mockWrites.mockReturnValue(null);
		const { tree } = await openBalance();
		await typeBalance(tree);
		await pressAsync(tree, "Update balance");
		expect(accounts.updateBalance.mock.calls[0]?.[0]).toEqual({
			id: ID,
			balance: "1500.00",
		});
		expect(writes.book).not.toHaveBeenCalled();
	});
});

import type { RetrospendClient } from "@retrospend/api-client";
import {
	disabled,
	mount,
	pressAsync,
	textOf,
	wait,
	world,
} from "../../../test/harness";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import type { Account } from "./source";

// Delete account stays online under the dev flag. While this phone holds a
// write about the account that no pull has shown back (an entry for it, or a
// transfer queued from or to it) it says "Sync first" and deletes nothing.
// Without the flag nothing is read from the outbox.
let mockFlag = false;
jest.mock("@/data/deviceWrites", () => ({
	deviceFlagOn: () => mockFlag,
	deviceWrites: () => null,
}));
jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);

const ID = "acct-old";
const account = {
	id: ID,
	name: "Old card",
	balance: { minor: 0, currency: "ARS" },
	closedAt: null,
} as unknown as Account;

function setup() {
	const accounts = {
		previewDelete: jest.fn(async () => ({
			changes: [],
			unchanged: [],
			unavailable: [],
			detail: {},
		})),
		delete: jest.fn(async (..._a: unknown[]) => ({
			result: { id: ID },
			undo: "tok",
		})),
	};
	world.api = { accounts } as unknown as RetrospendClient;
	return accounts;
}

const open = async () => {
	const tree = await mount(
		<DeleteAccountSheet
			account={account}
			onClose={jest.fn()}
			onCloseInstead={jest.fn()}
			onDone={jest.fn()}
			visible
		/>,
	);
	await wait(400);
	return tree;
};

const queue = (entry: Record<string, unknown>) =>
	world.local.outbox.enqueue({
		clientId: "k1",
		baseVersion: null,
		payload: {},
		...entry,
	} as never);

beforeEach(() => {
	mockFlag = true;
});

describe("Delete account with writes on the phone", () => {
	it("deletes when nothing waits on the phone for the account", async () => {
		const accounts = setup();
		const tree = await open();
		expect(disabled(tree, "Delete account")).toBe(false);
		await pressAsync(tree, "Delete account");
		expect(accounts.delete).toHaveBeenCalledTimes(1);
	});

	it("says Sync first and deletes nothing while a write for the account waits", async () => {
		const accounts = setup();
		await queue({ entity: "accounts", kind: "balance", targetId: ID });
		const tree = await open();
		expect(textOf(tree.root)).toContain("Sync first");
		expect(disabled(tree, "Delete account")).toBe(true);
		expect(accounts.previewDelete).not.toHaveBeenCalled();
		expect(accounts.delete).not.toHaveBeenCalled();
	});

	it("the same for a transfer queued from or to the account", async () => {
		const accounts = setup();
		await queue({
			entity: "transfers",
			kind: "create",
			targetId: "t1",
			payload: { fromAccountId: "other", toAccountId: ID },
		});
		const tree = await open();
		expect(textOf(tree.root)).toContain("Sync first");
		expect(accounts.delete).not.toHaveBeenCalled();
	});

	it("the same for a transfer delete, which names only the transfer, by the account its booking changed", async () => {
		const accounts = setup();
		await queue({
			entity: "transfers",
			kind: "delete",
			targetId: "t9",
			payload: { id: "t9" },
			device: {
				bookedAt: 1,
				changed: [],
				changes: [{ table: "accounts", id: ID, before: null, after: null }],
			},
		});
		const tree = await open();
		expect(textOf(tree.root)).toContain("Sync first");
		expect(accounts.delete).not.toHaveBeenCalled();
	});

	it("a write for another account does not stop it", async () => {
		const accounts = setup();
		await queue({ entity: "accounts", kind: "balance", targetId: "other" });
		const tree = await open();
		await pressAsync(tree, "Delete account");
		expect(accounts.delete).toHaveBeenCalledTimes(1);
	});

	it("without the dev flag the outbox is not read: the plain delete", async () => {
		mockFlag = false;
		const accounts = setup();
		await queue({ entity: "accounts", kind: "balance", targetId: ID });
		const tree = await open();
		expect(textOf(tree.root)).not.toContain("Sync first");
		await pressAsync(tree, "Delete account");
		expect(accounts.delete).toHaveBeenCalledTimes(1);
	});
});

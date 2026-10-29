import type { RetrospendClient } from "@retrospend/api-client";
import {
	disabled,
	press,
	session,
	type Tree,
	toast,
	wait,
} from "../budget/harness";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import type { Account } from "./source";

// Delete: the dry run first, the verb last and off until it is in,
// Close instead for an open account, and a toast with Undo: the server keeps
// the account and its history and puts it all back from the token.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/auth/session", () => require("../budget/harness").sessionMock);
jest.mock("@/data/ids", () => require("../budget/harness").idsMock);
jest.mock("@/ui/Toast", () => require("../budget/harness").toastMock);
jest.mock("@/ui/Button", () => require("../budget/harness").buttonMock);
jest.mock("@/ui/Sheet", () => {
	return {
		Sheet: ({
			visible,
			children,
			footer,
		}: {
			visible: boolean;
			children: unknown;
			footer?: unknown;
		}) =>
			visible ? (
				<>
					{children}
					{footer}
				</>
			) : null,
	};
});
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("../budget/harness").intlMock);

const account = {
	id: "acct-old",
	name: "Old card",
	balance: { minor: 0, currency: "ARS" },
	closedAt: null,
} as unknown as Account;

function fakeApi() {
	const calls: string[] = [];
	const api = {
		accounts: {
			previewDelete: async () => {
				calls.push("preview");
				return { changes: [], unchanged: [], unavailable: [], detail: {} };
			},
			delete: async () => {
				calls.push("write");
				return { result: { id: "acct-old" }, undo: "undo-account" };
			},
			undo: async (input: { token: string }) => {
				calls.push(`undo:${input.token}`);
				return { result: {}, redo: null };
			},
		},
	} as unknown as RetrospendClient;
	return { api, calls };
}

describe("Delete account", () => {
	it("keeps the verb off until the dry run is in, then deletes with an Undo that puts it back", async () => {
		const { api, calls } = fakeApi();
		session.api = api;
		const onDone = jest.fn();
		const onClose = jest.fn();
		toast.show.mockClear();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<DeleteAccountSheet
					account={account}
					onClose={onClose}
					onCloseInstead={jest.fn()}
					onDone={onDone}
					visible
				/>,
			);
		});
		expect(disabled(tree, "Delete")).toBe(true);
		await wait(400);
		expect(calls).toEqual(["preview"]);
		expect(disabled(tree, "Delete")).toBe(false);

		press(tree, "Delete");
		await wait(50);
		expect(calls).toEqual(["preview", "write"]);
		expect(onDone).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
		const shown = toast.show.mock.calls[0]?.[0] as {
			message: string;
			undo?: unknown;
		};
		expect(shown.message).toBe("Deleted Old card");
		const undo = shown.undo as { onUndo: () => Promise<void> };
		expect(undo).toBeDefined();
		await act(async () => undo.onUndo());
		expect(calls).toEqual(["preview", "write", "undo:undo-account"]);
		// The screen left once, when the account went; the Undo only refreshes.
		expect(onDone).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("offers Close instead for an open account only", async () => {
		session.api = fakeApi().api;
		const onCloseInstead = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<DeleteAccountSheet
					account={account}
					onClose={jest.fn()}
					onCloseInstead={onCloseInstead}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		press(tree, "Close instead");
		expect(onCloseInstead).toHaveBeenCalled();
		act(() => tree.unmount());

		await act(async () => {
			tree = create(
				<DeleteAccountSheet
					account={{ ...account, closedAt: "2026-01-01T00:00:00.000Z" }}
					onClose={jest.fn()}
					onCloseInstead={onCloseInstead}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		expect(() => press(tree, "Close instead")).toThrow();
		act(() => tree.unmount());
	});
});

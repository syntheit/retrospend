import type { RetrospendClient } from "@retrospend/api-client";
import {
	disabled,
	press,
	session,
	type Tree,
	typeInto,
	wait,
} from "../budget/harness";
import { AccountSheet } from "./AccountSheet";
import type { Account } from "./source";

// Edit account writes a balance checkpoint from its form, so the form must
// start from a fresh read of the account, not from the list the screen cached.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/auth/session", () => require("../budget/harness").sessionMock);
jest.mock("@/data/ids", () => require("../budget/harness").idsMock);
jest.mock("@/ui/Toast", () => require("../budget/harness").toastMock);
jest.mock("@/ui/Button", () => require("../budget/harness").buttonMock);
jest.mock("@/ui/Sheet", () => require("../budget/harness").sheetMock);
jest.mock("@/ui/SwitchRow", () => require("../budget/harness").switchMock);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("../budget/harness").intlMock);
jest.mock("@/ui/TextField", () => {
	const { Pressable } = require("react-native");
	return {
		TextField: ({ label, onChangeText }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				onChangeText={onChangeText}
			/>
		),
	};
});
jest.mock("@/ui/Picker", () => ({ Picker: () => null }));
jest.mock("@/ui/CurrencyPicker", () => ({ CurrencyPicker: () => null }));

const ars = (minor: number) => ({ minor, currency: "ARS" });
const base = {
	id: "acct-galicia",
	name: "Galicia",
	type: "CHECKING",
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
// What the screen cached, and what the server holds now.
const cached = { ...base, balance: ars(10_000) } as unknown as Account;
const current = { ...base, balance: ars(25_000) };

function fakeApi(read: () => Promise<unknown>) {
	const calls: { route: string; input: unknown }[] = [];
	const preview = {
		changes: [],
		unchanged: [],
		unavailable: [],
		detail: { kind: "account.update", result: {} },
	};
	const api = {
		accounts: {
			get: async (input: unknown) => {
				calls.push({ route: "get", input });
				return read();
			},
			previewUpdate: async (input: unknown) => {
				calls.push({ route: "preview", input });
				return preview;
			},
			update: async (input: unknown) => {
				calls.push({ route: "write", input });
				return { result: {}, undo: "undo-1" };
			},
		},
	} as unknown as RetrospendClient;
	return { api, calls };
}

async function open() {
	let tree!: Tree;
	await act(async () => {
		tree = create(
			<AccountSheet
				account={cached}
				catalog={[{ code: "ARS", rateTypes: [] }] as never}
				home="ARS"
				onClose={jest.fn()}
				onDone={jest.fn()}
				visible
			/>,
		);
	});
	return tree;
}

describe("Edit account", () => {
	it("keeps Save off until the fresh read is in, then writes the fresh balance", async () => {
		let answer: (value: unknown) => void = () => undefined;
		const { api, calls } = fakeApi(
			() => new Promise((resolve) => (answer = resolve)),
		);
		session.api = api;
		const tree = await open();
		await wait(400);
		expect(calls.map((c) => c.route)).toEqual(["get"]);
		expect(calls[0]?.input).toEqual({ id: "acct-galicia" });
		expect(disabled(tree, "Save")).toBe(true);

		await act(async () => {
			answer(current);
		});
		await wait(400);
		typeInto(tree, "Name", "Galicia main");
		await wait(400);
		const previews = calls.filter((c) => c.route === "preview");
		expect(previews.at(-1)?.input).toMatchObject({
			name: "Galicia main",
			balance: "250.00",
		});
		expect(disabled(tree, "Save")).toBe(false);

		press(tree, "Save");
		await wait(50);
		expect(calls.find((c) => c.route === "write")?.input).toMatchObject({
			balance: "250.00",
		});
		act(() => tree.unmount());
	});

	it("never saves when the read fails", async () => {
		const { api, calls } = fakeApi(() => Promise.reject(new Error("offline")));
		session.api = api;
		const tree = await open();
		await wait(400);
		expect(disabled(tree, "Save")).toBe(true);
		expect(calls.some((c) => c.route === "preview")).toBe(false);
		act(() => tree.unmount());
	});
});

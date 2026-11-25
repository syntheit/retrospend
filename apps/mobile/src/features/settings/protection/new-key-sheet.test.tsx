import { type KeyDraft, KeyFlowError } from "@retrospend/crypto/client";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { useState } from "react";
import {
	act,
	disabled,
	mount,
	pressAsync,
	type Tree,
	type as typeInto,
	words,
} from "../../../../test/harness";
import { NewKeySheet, type NewKeySheetProps } from "./NewKeySheet";

// Make new key on the phone: the current password, the new key shown, two
// groups typed back, then the save. The old key keeps working until the save
// is read back, so every exit before that wipes the draft and sends nothing.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/crypto/native", () => ({ getPrimitives: jest.fn() }));
const mockSheetProps = jest.fn();
jest.mock("@/ui/Sheet", () => ({
	useSheetBodySize: () => ({}),
	Sheet: (props: {
		visible?: boolean;
		children?: unknown;
		footer?: unknown;
	}) => {
		mockSheetProps(props);
		return props.visible === false
			? null
			: ([props.children, props.footer] as never);
	},
}));
const lastSheet = () =>
	mockSheetProps.mock.calls.at(-1)?.[0] as {
		locked: boolean;
		onClose: () => void;
	};
jest.mock("@/ui/Button", () => require("../../../../test/native").buttonMock);
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));
const mockCopy = jest.fn();
jest.mock("./recoveryKeyActions", () => ({
	copyRecoveryKey: (...a: unknown[]) => mockCopy(...a),
	saveRecoveryKeyFile: jest.fn(),
}));

const found = vectors.recoveryKeys.find((k) => {
	const groups = k.text.split("-");
	return new Set(groups).size === groups.length;
});
if (!found) throw new Error("no vector with nine different groups");
const KEY = found.text;
const GROUPS = KEY.split("-");

const makeKey = jest.fn();
const save = jest.fn();
const onClose = jest.fn();
const onDone = jest.fn();
const drafts: { keyText: string; wipe: jest.Mock }[] = [];
const draftOf = () => {
	const draft = { keyText: KEY, wipe: jest.fn() };
	drafts.push(draft);
	return draft as unknown as KeyDraft;
};

let setVisible: (visible: boolean) => void = () => undefined;
function Host(over: Partial<NewKeySheetProps>) {
	const [visible, set] = useState(true);
	setVisible = set;
	return (
		<NewKeySheet
			account="ana@example.com"
			makeKey={makeKey}
			onClose={onClose}
			onDone={onDone}
			// Always the first candidate: groups 1 and 2.
			random={() => 0}
			save={save}
			visible={visible}
			{...over}
		/>
	);
}
const show = () => mount(<Host />);
const CHOOSE = "Your old key stops working when the new one is saved.";

async function toKey(tree: Tree) {
	typeInto(tree, "Password", "my password");
	await pressAsync(tree, "Continue");
}
async function toConfirm(tree: Tree) {
	await toKey(tree);
	await pressAsync(tree, "I saved it");
}

beforeEach(() => {
	for (const fn of [makeKey, save, onClose, onDone, mockCopy, mockSheetProps])
		fn.mockReset();
	drafts.length = 0;
	makeKey.mockImplementation(async () => draftOf());
	save.mockResolvedValue(undefined);
});

describe("NewKeySheet", () => {
	it("needs the password to continue, then shows the new key", async () => {
		const tree = await show();
		expect(words(tree)).toContain(CHOOSE);
		expect(disabled(tree, "Continue")).toBe(true);
		typeInto(tree, "Password", "my password");
		expect(disabled(tree, "Continue")).toBe(false);
		await pressAsync(tree, "Continue");
		expect(makeKey).toHaveBeenCalledWith("my password");
		for (const group of GROUPS) expect(words(tree)).toContain(group);
		// The password is gone from the sheet.
		expect(
			tree.root.findAll((n) => n.props.accessibilityLabel === "Password"),
		).toHaveLength(0);
	});

	it("says a wrong password and stays on the password step, sending nothing", async () => {
		makeKey.mockRejectedValueOnce(new KeyFlowError("wrongPassword"));
		const tree = await show();
		await toKey(tree);
		expect(words(tree)).toContain("Wrong password");
		expect(words(tree)).toContain(CHOOSE);
		expect(save).not.toHaveBeenCalled();
	});

	it("asks for two groups and saves only when both are typed right", async () => {
		const tree = await show();
		await toConfirm(tree);
		expect(disabled(tree, "Save key")).toBe(true);
		typeInto(tree, "Group 1", GROUPS[0] ?? "");
		typeInto(tree, "Group 2", "ZZZZZZ");
		expect(words(tree)).toContain("Does not match");
		expect(disabled(tree, "Save key")).toBe(true);
		typeInto(tree, "Group 2", GROUPS[1] ?? "");
		expect(disabled(tree, "Save key")).toBe(false);
		await pressAsync(tree, "Save key");
		expect(save).toHaveBeenCalledWith(drafts[0]);
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		// Closing wipes the draft the save was made with.
		expect(drafts[0]?.wipe).toHaveBeenCalledTimes(1);
	});

	it("says the key was not saved, ends there, and wipes the draft on Close", async () => {
		save.mockRejectedValueOnce(new KeyFlowError("readBackFailed"));
		const tree = await show();
		await toConfirm(tree);
		typeInto(tree, "Group 1", GROUPS[0] ?? "");
		typeInto(tree, "Group 2", GROUPS[1] ?? "");
		await pressAsync(tree, "Save key");
		expect(words(tree)).toContain(
			"Your new key could not be saved. Your old key still works.",
		);
		expect(onDone).not.toHaveBeenCalled();
		await pressAsync(tree, "Close");
		expect(drafts[0]?.wipe).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("starts over with the password when the keys changed under it, wiping the stale draft", async () => {
		save.mockRejectedValueOnce(new KeyFlowError("conflict"));
		const tree = await show();
		await toConfirm(tree);
		typeInto(tree, "Group 1", GROUPS[0] ?? "");
		typeInto(tree, "Group 2", GROUPS[1] ?? "");
		await pressAsync(tree, "Save key");
		expect(words(tree)).toContain("Your keys changed. Start again.");
		expect(words(tree)).toContain(CHOOSE);
		expect(drafts[0]?.wipe).toHaveBeenCalledTimes(1);
	});

	it("Back from the key to the password wipes the draft, and Back from the groups keeps it", async () => {
		const tree = await show();
		await toConfirm(tree);
		await pressAsync(tree, "Back");
		// Back to the key: the draft stays, the same key is shown.
		expect(drafts[0]?.wipe).not.toHaveBeenCalled();
		for (const group of GROUPS) expect(words(tree)).toContain(group);
		await pressAsync(tree, "Back");
		expect(drafts[0]?.wipe).toHaveBeenCalledTimes(1);
		expect(words(tree)).toContain(CHOOSE);
	});

	it("Cancel and a parent closing the sheet both wipe the draft once", async () => {
		const tree = await show();
		await toKey(tree);
		await pressAsync(tree, "Back");
		await toKey(tree);
		await pressAsync(tree, "Back");
		expect(drafts.map((d) => d.wipe.mock.calls.length)).toEqual([1, 1]);
		await toKey(tree);
		await act(async () => setVisible(false));
		expect(drafts[2]?.wipe).toHaveBeenCalledTimes(1);
	});

	it("unmounting wipes the draft", async () => {
		const tree = await show();
		await toKey(tree);
		act(() => tree.unmount());
		expect(drafts[0]?.wipe).toHaveBeenCalledTimes(1);
	});
});

describe("NewKeySheet, a running job is not cut off", () => {
	it("is locked and refuses a swipe down or back while the key is being saved", async () => {
		let release: () => void = () => undefined;
		save.mockReturnValue(new Promise<void>((r) => (release = r)));
		const tree = await show();
		await toConfirm(tree);
		typeInto(tree, "Group 1", GROUPS[0] ?? "");
		typeInto(tree, "Group 2", GROUPS[1] ?? "");
		expect(lastSheet().locked).toBe(false);
		await pressAsync(tree, "Save key");
		expect(lastSheet().locked).toBe(true);
		act(() => lastSheet().onClose());
		expect(onClose).not.toHaveBeenCalled();
		expect(drafts[0]?.wipe).not.toHaveBeenCalled();
		await act(async () => release());
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("NewKeySheet, the password step", () => {
	it("makes the key from the keyboard's Go, and says so", async () => {
		const tree = await show();
		typeInto(tree, "Password", "my password");
		const field = tree.root.findAll(
			(n) =>
				n.props.accessibilityLabel === "Password" &&
				typeof n.props.onSubmitEditing === "function",
		)[0];
		expect(field?.props.returnKeyType).toBe("go");
		if (!field) throw new Error("no password field");
		await act(async () => (field.props.onSubmitEditing as () => void)());
		expect(makeKey).toHaveBeenCalledWith("my password");
	});
});

describe("NewKeySheet, the app switcher", () => {
	it("covers the sheet while the app is not in front", async () => {
		const listeners: ((state: string) => void)[] = [];
		const { AppState } = require("react-native");
		jest
			.spyOn(AppState, "addEventListener")
			.mockImplementation((_event: unknown, listener: unknown) => {
				listeners.push(listener as (state: string) => void);
				return { remove: () => undefined };
			});
		const tree = await show();
		const cover = () =>
			tree.root.findAll(
				(n) => typeof n.type === "string" && n.props.testID === "privacy-cover",
			);
		expect(cover()).toHaveLength(0);
		await act(async () => {
			for (const l of listeners) l("background");
		});
		expect(cover().length).toBeGreaterThan(0);
		jest.restoreAllMocks();
	});
});

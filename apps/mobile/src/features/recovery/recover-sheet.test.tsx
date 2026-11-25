import { KeyFlowError, type RecoveryHandle } from "@retrospend/crypto/client";
import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { useState } from "react";
import {
	act,
	disabled,
	flush,
	mount,
	pressAsync,
	type Tree,
	type as typeInto,
	words,
} from "../../../test/harness";
import { RecoverSheet, type RecoverSheetProps } from "./RecoverSheet";
import { focusAfterKey, focusAfterTyping } from "./RecoverSteps";

// Use your recovery key and Set a new password on the phone: the nine groups,
// a paste, the proof before a password is asked for, and that what the proof
// opened is wiped on every way out. The sheet only calls back; the proof and
// the commit are the shared core's (packages/crypto/test).
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../../packages/api-contract/src/account/password-rules",
	),
);
// The sheet as a stand-in that keeps what it was given, so a test can swipe it
// down (call its onClose) and see whether it is locked.
const mockSheetProps = jest.fn();
jest.mock("@/ui/Sheet", () => ({
	useSheetBodySize: () => ({}),
	Sheet: (props: {
		visible?: boolean;
		children?: unknown;
		footer?: unknown;
	}) => {
		mockSheetProps(props);
		return props.visible === false ? null : ([props.children, props.footer] as never);
	},
}));
const lastSheet = () =>
	mockSheetProps.mock.calls.at(-1)?.[0] as {
		locked: boolean;
		onClose: () => void;
	};
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));

const KEY = vectors.recoveryKeys[2]?.text ?? "";
const GROUPS = KEY.split("-");
const PASSWORD = "Battery staple 2";

const begin = jest.fn();
const finish = jest.fn();
const onClose = jest.fn();
const onDone = jest.fn();
const handles: { wipe: jest.Mock }[] = [];
const handleOf = () => {
	const handle = { wipe: jest.fn() };
	handles.push(handle);
	return handle as unknown as RecoveryHandle;
};

// The sheet inside a parent that can close it from outside (visible false).
let setVisible: (visible: boolean) => void = () => undefined;
function Host(over: Partial<RecoverSheetProps>) {
	const [visible, set] = useState(true);
	setVisible = set;
	return (
		<RecoverSheet
			begin={begin}
			finish={finish}
			onClose={onClose}
			onDone={onDone}
			visible={visible}
			{...over}
		/>
	);
}
const show = (over: Partial<RecoverSheetProps> = {}) =>
	mount(<Host {...over} />);
const closeFromOutside = () => act(async () => setVisible(false));
const ENTER = "Enter the 9 groups, or paste the whole key.";
const NEW_PASSWORD = "Your recovery key opened your data. Choose a new password.";

const group = (tree: Tree, n: number) =>
	tree.root.findAll(
		(node) =>
			node.props.accessibilityLabel === `Group ${n}` &&
			typeof node.props.onChangeText === "function",
	)[0];
const valueIn = (tree: Tree, n: number) => group(tree, n)?.props.value;
const typeGroup = (tree: Tree, n: number, text: string) =>
	typeInto(tree, `Group ${n}`, text);
const fillAll = (tree: Tree) => {
	for (let i = 0; i < 9; i++) typeGroup(tree, i + 1, GROUPS[i] ?? "");
};
const toPassword = async (tree: Tree) => {
	fillAll(tree);
	await pressAsync(tree, "Continue");
};
const fillPasswords = (tree: Tree, a = PASSWORD, b = PASSWORD) => {
	typeInto(tree, "New password", a);
	typeInto(tree, "Confirm new password", b);
};

beforeEach(() => {
	for (const fn of [begin, finish, onClose, onDone, mockSheetProps])
		fn.mockReset();
	handles.length = 0;
	begin.mockImplementation(async () => handleOf());
	finish.mockResolvedValue("set");
});

describe("RecoverSheet, the key", () => {
	it("keeps Continue off until all nine groups are full, then proves the key as one text", async () => {
		const tree = await show();
		expect(words(tree)).toContain(ENTER);
		expect(disabled(tree, "Continue")).toBe(true);
		for (let i = 0; i < 8; i++) typeGroup(tree, i + 1, GROUPS[i] ?? "");
		expect(disabled(tree, "Continue")).toBe(true);
		typeGroup(tree, 9, GROUPS[8] ?? "");
		expect(disabled(tree, "Continue")).toBe(false);
		await pressAsync(tree, "Continue");
		expect(begin).toHaveBeenCalledWith(KEY);
	});

	it("fills all nine groups from a whole key pasted into any one of them, whatever the case and separators", async () => {
		const tree = await show();
		typeGroup(tree, 5, KEY.toLowerCase());
		for (let i = 0; i < 9; i++) expect(valueIn(tree, i + 1)).toBe(GROUPS[i]);
		expect(disabled(tree, "Continue")).toBe(false);
		// Spaces instead of hyphens, and the look-alikes read as the key reads them.
		const again = await show();
		typeGroup(again, 2, KEY.replaceAll("-", " "));
		for (let i = 0; i < 9; i++) expect(valueIn(again, i + 1)).toBe(GROUPS[i]);
	});

	it("fills from the group a partial paste lands in, and does not call one typed character a paste", async () => {
		const tree = await show();
		typeGroup(tree, 3, "AAAAAABBBBBB");
		expect(valueIn(tree, 3)).toBe("AAAAAA");
		expect(valueIn(tree, 4)).toBe("BBBBBB");
		expect(valueIn(tree, 2)).toBe("");
		// A seventh character typed into a full group is cut, not spilled over.
		typeGroup(tree, 3, "AAAAAAC");
		expect(valueIn(tree, 3)).toBe("AAAAAA");
		expect(valueIn(tree, 4)).toBe("BBBBBB");
	});

	it("says a typo and a wrong key under the groups and lets the person type again", async () => {
		const tree = await show();
		fillAll(tree);
		begin.mockRejectedValueOnce(new KeyFlowError("typo"));
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("Check the key for a typo.");
		begin.mockRejectedValueOnce(new KeyFlowError("wrongRecoveryKey"));
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("That is not this account's recovery key.");
		expect(handles).toHaveLength(0);
		expect(disabled(tree, "Continue")).toBe(false);
		// Typing a group clears the line.
		typeGroup(tree, 1, "ZZZZZZ");
		expect(words(tree)).not.toContain("That is not this account's recovery key.");
	});

	it("asks for the new password only after the key was proven", async () => {
		const tree = await show();
		expect(tree.root.findAll((n) => n.props.accessibilityLabel === "New password")).toHaveLength(0);
		await toPassword(tree);
		expect(words(tree)).toContain(NEW_PASSWORD);
		expect(begin).toHaveBeenCalledTimes(1);
		expect(finish).not.toHaveBeenCalled();
	});
});

describe("RecoverSheet, the new password", () => {
	it("waits for the rules and two matching entries, then sets it with the handle begin made", async () => {
		const tree = await show();
		await toPassword(tree);
		expect(disabled(tree, "Set password")).toBe(true);
		fillPasswords(tree, "short", "short");
		expect(disabled(tree, "Set password")).toBe(true);
		fillPasswords(tree, PASSWORD, "Battery staple 3");
		expect(disabled(tree, "Set password")).toBe(true);
		fillPasswords(tree);
		expect(disabled(tree, "Set password")).toBe(false);
		await pressAsync(tree, "Set password");
		expect(finish).toHaveBeenCalledWith(handles[0], { password: PASSWORD });
		expect(onDone).toHaveBeenCalledWith("set");
	});

	it("passes a spent link on, so the person is told to sign in", async () => {
		finish.mockResolvedValue("linkSpent");
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		await pressAsync(tree, "Set password");
		expect(onDone).toHaveBeenCalledWith("linkSpent");
	});

	it("shows the working label while Argon2id runs, and presses nothing twice", async () => {
		let release: (v: string) => void = () => undefined;
		finish.mockReturnValue(new Promise((r) => (release = r)));
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		await pressAsync(tree, "Set password");
		expect(disabled(tree, "Setting your password")).toBe(true);
		expect(finish).toHaveBeenCalledTimes(1);
		await act(async () => release("set"));
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it("goes back to the key with the password gone when the proof no longer stands", async () => {
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		finish.mockRejectedValueOnce(new KeyFlowError("conflict"));
		await pressAsync(tree, "Set password");
		expect(words(tree)).toContain("Your keys changed. Start again.");
		expect(words(tree)).toContain(ENTER);
		// What the proof opened is wiped, and no password is left in the sheet.
		expect(handles[0]?.wipe).toHaveBeenCalledTimes(1);
		expect(tree.root.findAll((n) => n.props.accessibilityLabel === "New password")).toHaveLength(0);
	});

	it("locks both password fields once a commit may have gone through, and the retry sends through the same handle", async () => {
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		finish.mockRejectedValueOnce(new KeyFlowError("unconfirmed"));
		await pressAsync(tree, "Set password");
		expect(words(tree)).toContain("We couldn't confirm it. Try again.");
		// The wait is over: the sheet can be closed, and Retry sends the same request.
		expect(lastSheet().locked).toBe(false);
		for (const label of ["New password", "Confirm new password"])
			expect(group2(tree, label)?.props.editable).toBe(false);
		await pressAsync(tree, "Set password");
		expect(finish).toHaveBeenCalledTimes(2);
		expect(finish.mock.calls[1]?.[0]).toBe(handles[0]);
	});

	it("keeps the password editable after a refusal that sent nothing", async () => {
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		finish.mockRejectedValueOnce(new KeyFlowError("rateLimited"));
		await pressAsync(tree, "Set password");
		expect(words(tree)).toContain("Too many tries, wait a minute and try again.");
		expect(group2(tree, "New password")?.props.editable).not.toBe(false);
	});

	it("ends on its words with only Close when the link is gone", async () => {
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		finish.mockRejectedValueOnce(new KeyFlowError("tokenExpired"));
		await pressAsync(tree, "Set password");
		expect(words(tree)).toContain("This link has expired or was already used.");
		expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Set password")).toHaveLength(0);
		expect(handles[0]?.wipe).toHaveBeenCalledTimes(1);
		await pressAsync(tree, "Close");
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

const group2 = (tree: Tree, label: string) =>
	tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.onChangeText === "function",
	)[0];

describe("RecoverSheet, every way out wipes what the proof opened", () => {
	it("Cancel wipes the handle once and reopens at the start with nothing typed", async () => {
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		await pressAsync(tree, "Cancel");
		expect(handles[0]?.wipe).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		await flush();
		expect(words(tree)).toContain(ENTER);
		expect(valueIn(tree, 1)).toBe("");
	});

	it("closing from outside (visible turns false) wipes the handle and clears what was typed", async () => {
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		await closeFromOutside();
		expect(handles[0]?.wipe).toHaveBeenCalledTimes(1);
		await act(async () => setVisible(true));
		expect(words(tree)).toContain(ENTER);
		expect(valueIn(tree, 1)).toBe("");
	});

	it("unmounting wipes the handle", async () => {
		const tree = await show();
		await toPassword(tree);
		act(() => tree.unmount());
		expect(handles[0]?.wipe).toHaveBeenCalledTimes(1);
	});

	it("a proof that arrives after the sheet closed is wiped and never shown", async () => {
		let release: (h: RecoveryHandle) => void = () => undefined;
		begin.mockReturnValue(new Promise((r) => (release = r)));
		const tree = await show();
		fillAll(tree);
		await pressAsync(tree, "Continue");
		await closeFromOutside();
		await act(async () => setVisible(true));
		const late = handleOf();
		await act(async () => release(late));
		expect(late.wipe).toHaveBeenCalledTimes(1);
		// The reopened sheet is at its first step: the late proof did not move it on.
		expect(words(tree)).toContain(ENTER);
	});

	it("a commit that finished after the sheet closed still tells the caller the password is set", async () => {
		let release: (v: "set") => void = () => undefined;
		finish.mockReturnValue(new Promise((r) => (release = r)));
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		await pressAsync(tree, "Set password");
		await closeFromOutside();
		await act(async () => release("set"));
		expect(onDone).toHaveBeenCalledWith("set");
	});
});

describe("RecoverSheet, a running job is not cut off", () => {
	it("is locked and refuses a swipe down or Android's back while the commit runs, then closes when it is done", async () => {
		let release: (v: "set") => void = () => undefined;
		finish.mockReturnValue(new Promise((r) => (release = r)));
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		expect(lastSheet().locked).toBe(false);
		await pressAsync(tree, "Set password");
		expect(lastSheet().locked).toBe(true);
		// The sheet's own onClose is what the platform calls for a swipe or back.
		act(() => lastSheet().onClose());
		expect(onClose).not.toHaveBeenCalled();
		expect(handles[0]?.wipe).not.toHaveBeenCalled();
		await act(async () => release("set"));
		expect(onDone).toHaveBeenCalledWith("set");
		// The job is over: the sheet closes again (the caller then leaves the screen).
		act(() => lastSheet().onClose());
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("is locked while the key is being proven too", async () => {
		begin.mockReturnValue(new Promise(() => {}));
		const tree = await show();
		fillAll(tree);
		await pressAsync(tree, "Continue");
		expect(lastSheet().locked).toBe(true);
		act(() => lastSheet().onClose());
		expect(onClose).not.toHaveBeenCalled();
	});

	it("a commit that is refused after the sheet closed is dropped: nothing is reported as set", async () => {
		let fail: (e: unknown) => void = () => undefined;
		finish.mockReturnValue(new Promise((_, reject) => (fail = reject)));
		const tree = await show();
		await toPassword(tree);
		fillPasswords(tree);
		await pressAsync(tree, "Set password");
		await closeFromOutside();
		await act(async () => fail(new KeyFlowError("rateLimited")));
		expect(onDone).not.toHaveBeenCalled();
	});
});

describe("RecoverSheet, the app switcher", () => {
	it("covers the sheet while the app is not in front, and shows it again on return", async () => {
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
			for (const l of listeners) l("inactive");
		});
		expect(cover().length).toBeGreaterThan(0);
		await act(async () => {
			for (const l of listeners) l("active");
		});
		expect(cover()).toHaveLength(0);
		jest.restoreAllMocks();
	});
});

describe("RecoverSheet, the groups", () => {
	it("says Next on every group but the last, which says Done", async () => {
		const tree = await show();
		const fields = tree.root.findAll(
			(n) =>
				typeof n.type === "string" &&
				typeof n.props.onChangeText === "function" &&
				typeof n.props.accessibilityLabel === "string" &&
				n.props.accessibilityLabel.startsWith("Group "),
		);
		expect(fields).toHaveLength(9);
		for (const field of fields.slice(0, 8))
			expect(field.props.returnKeyType).toBe("next");
		expect(fields[8]?.props.returnKeyType).toBe("done");
	});

	it("moves to the next group once one is full, and not before, and not past the ninth", () => {
		expect(focusAfterTyping(0, "ABCDE")).toBeNull();
		expect(focusAfterTyping(0, "ABCDEF")).toBe(1);
		expect(focusAfterTyping(4, "abcdef")).toBe(5);
		expect(focusAfterTyping(8, "ABCDEF")).toBeNull();
	});

	it("steps back on Backspace in an empty group only", () => {
		expect(focusAfterKey(3, "Backspace", "")).toBe(2);
		expect(focusAfterKey(3, "Backspace", "A")).toBeNull();
		expect(focusAfterKey(3, "a", "")).toBeNull();
		expect(focusAfterKey(0, "Backspace", "")).toBeNull();
	});
});

import vectors from "@retrospend/crypto/vectors/keys.vectors.json";
import { EnableSheet, type EnableSheetProps } from "./EnableSheet";

// The enable sheet's view states, one step at a time: what changes, the new
// password, the ways back in, saving the recovery key, retyping two groups,
// confirming it is you, and the end, where the notice says the keys are made
// and nothing is sealed yet. The sheet only calls back; these tests drive it
// the way a person does and read what it shows.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

// The contract's runtime is ESM, so the sheet gets the real password rules
// file (it imports nothing) in its place.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/crypto/native", () => ({ getPrimitives: jest.fn() }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));
jest.mock("@/ui/Sheet", () => {
	const { View, Text } = require("react-native");
	return {
		useSheetBodySize: () => ({}),
		Sheet: ({
			children,
			footer,
			title,
			visible,
			onClose,
		}: {
			children: unknown;
			footer: unknown;
			title: string;
			visible: boolean;
			onClose: () => void;
		}) =>
			visible ? (
				<View>
					<Text onPress={onClose} testID="sheet-close">
						{title}
					</Text>
					{children}
					<View testID="footer">{footer}</View>
				</View>
			) : null,
	};
});
jest.mock("@/ui/TextField", () => {
	const { TextInput, Text } = require("react-native");
	return {
		FieldError: ({ children }: { children: string }) => <Text>{children}</Text>,
		TextField: (props: {
			label: string;
			value: string;
			invalid?: boolean;
			onChangeText(v: string): void;
		}) => (
			<TextInput
				accessibilityState={{ invalid: !!props.invalid }}
				onChangeText={props.onChangeText}
				testID={`field:${props.label}`}
				value={props.value}
			/>
		),
	};
});
jest.mock("@/ui/Button", () => {
	const { Pressable, Text } = require("react-native");
	return {
		Button: (props: {
			label: string;
			disabled?: boolean;
			busy?: boolean;
			onPress(): void;
		}) => (
			<Pressable
				accessibilityState={{ disabled: !!props.disabled, busy: !!props.busy }}
				onPress={props.onPress}
				testID={`button:${props.label}`}
			>
				<Text>{props.label}</Text>
			</Pressable>
		),
	};
});
jest.mock("use-intl", () => {
	const { loadMessages } = require("@/lib/i18n");
	const messages = loadMessages("en");
	const lookup = (ns: string | undefined, key: string) =>
		(ns ? `${ns}.${key}` : key)
			.split(".")
			// biome-ignore lint/suspicious/noExplicitAny: a walk over the JSON tree
			.reduce((node: any, part: string) => node?.[part], messages);
	return {
		useTranslations:
			(ns?: string) => (key: string, values?: Record<string, unknown>) =>
				String(lookup(ns, key) ?? key).replace(
					/\{(\w+)\}/g,
					(_, name: string) => String(values?.[name]),
				),
	};
});
const mockCopy = jest.fn();
const mockSave = jest.fn();
jest.mock("./recoveryKeyActions", () => ({
	copyRecoveryKey: (...a: unknown[]) => mockCopy(...a),
	saveRecoveryKeyFile: (...a: unknown[]) => mockSave(...a),
}));

// A vector whose nine groups are all different, so a wrong group is never
// accidentally another group's twin.
const found = vectors.recoveryKeys.find((k) => {
	const groups = k.text.split("-");
	return new Set(groups).size === groups.length;
});
if (!found) throw new Error("no vector with nine different groups");
const KEY = found.text;
const GROUPS = KEY.split("-");
const PASSWORD = "Battery staple 2";

const makeKeys = jest.fn();
const confirm = jest.fn();
const discard = jest.fn();
const onClose = jest.fn();

function render(extra: Partial<EnableSheetProps> = {}) {
	const element = (visible: boolean) => (
		<EnableSheet
			account="ana@example.com"
			confirm={confirm}
			discard={discard}
			makeKeys={makeKeys}
			onClose={onClose}
			// Always the first candidate, so Back's "new groups" is visible.
			random={() => 0}
			twoFactor={false}
			visible={visible}
			{...extra}
		/>
	);
	let root: { root: TestNode; update(e: unknown): void } | undefined;
	act(() => {
		root = create(element(true));
	});
	if (!root) throw new Error("not rendered");
	const tree = root.root;
	const find = (id: string) =>
		tree.findAll((n) => n.props.testID === id)[0] as TestNode | undefined;
	const must = (id: string): TestNode => {
		const node = find(id);
		if (!node) throw new Error(`nothing with id ${id}`);
		return node;
	};
	const press = async (label: string) => {
		const node = find(`button:${label}`);
		if (!node) throw new Error(`no button ${label}`);
		// Not awaited: a run that is still pending (the busy state) must not hang the press.
		await act(async () => {
			(node.props.onPress as () => void)();
		});
	};
	const type = (label: string, text: string) =>
		act(() => {
			(must(`field:${label}`).props.onChangeText as (v: string) => void)(text);
		});
	const disabled = (label: string) =>
		(
			find(`button:${label}`)?.props.accessibilityState as
				| { disabled: boolean }
				| undefined
		)?.disabled;
	const texts = () =>
		tree
			// Host nodes only, so a word is counted once, not once per wrapper.
			.findAll(
				(n) =>
					typeof n.type === "string" && typeof n.props.children === "string",
			)
			.map((n) => n.props.children as string);
	const title = () => find("sheet-close")?.props.children as string | undefined;
	const setVisible = (visible: boolean) =>
		act(() => root?.update(element(visible)));
	return { find, must, press, type, disabled, texts, title, setVisible };
}

type Screen = ReturnType<typeof render>;

async function toMethods(s: Screen) {
	await s.press("Continue");
	s.type("New password", PASSWORD);
	s.type("Confirm new password", PASSWORD);
	await s.press("Continue");
}

async function toConfirmKey(s: Screen) {
	await toMethods(s);
	await s.press("Create key");
	await s.press("I saved it");
}

async function toConfirmYou(s: Screen) {
	await toConfirmKey(s);
	// random() is 0 and no pair came before: groups 1 and 2.
	s.type("Group 1", GROUPS[0] as string);
	s.type("Group 2", GROUPS[1] as string);
	await s.press("Continue");
	await s.press("Continue");
}

beforeEach(() => {
	for (const fn of [makeKeys, confirm, discard, onClose, mockCopy, mockSave])
		fn.mockReset();
	mockToast.show.mockReset();
	makeKeys.mockResolvedValue({ ok: true, recoveryKeyText: KEY });
	confirm.mockResolvedValue({ ok: true });
});

describe("EnableSheet, what changes", () => {
	it("says what changes and what stays, and cancels", async () => {
		const s = render();
		expect(s.title()).toBe("Turn on Advanced protection");
		expect(s.texts()).toEqual(
			expect.arrayContaining([
				"What this changes",
				"Your expenses, budgets and Wealth are sealed with a key only your devices hold.",
				"Shared expenses and projects stay visible to the server and the people in them.",
				"Amounts in older backups stay for 30 days.",
				"Some features turn off.",
				"What stays the same",
				"Your data, figures and sign-in.",
			]),
		);
		// No page to send "See which" to unless the caller gives one.
		expect(s.texts()).not.toContain("See which");
		await s.press("Cancel");
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(discard).toHaveBeenCalled();
	});

	it("draws See which when the caller has a place for it", () => {
		const onSeeWhich = jest.fn();
		const s = render({ onSeeWhich });
		expect(s.texts()).toContain("See which");
	});
});

describe("EnableSheet, new password", () => {
	it("waits for every rule and two matching entries", async () => {
		const s = render();
		await s.press("Continue");
		expect(s.title()).toBe("Set a new password");
		expect(s.disabled("Continue")).toBe(true);
		s.type("New password", "short");
		s.type("Confirm new password", "short");
		expect(s.disabled("Continue")).toBe(true);
		s.type("New password", PASSWORD);
		expect(s.texts()).toContain("The new passwords don't match");
		expect(s.disabled("Continue")).toBe(true);
		s.type("Confirm new password", PASSWORD);
		expect(s.texts()).not.toContain("The new passwords don't match");
		expect(s.disabled("Continue")).toBe(false);
	});

	it("shows the busy state while the keys are made, then drops the password", async () => {
		let release: (r: unknown) => void = () => undefined;
		makeKeys.mockReturnValue(new Promise((r) => (release = r)));
		const s = render();
		await s.press("Continue");
		s.type("New password", PASSWORD);
		s.type("Confirm new password", PASSWORD);
		await s.press("Continue");
		expect(makeKeys).toHaveBeenCalledTimes(1);
		expect(makeKeys).toHaveBeenCalledWith(PASSWORD);
		// The label changes and a second press does nothing.
		expect(s.disabled("Making your keys")).toBe(true);
		await s.press("Making your keys");
		expect(makeKeys).toHaveBeenCalledTimes(1);
		await act(async () => release({ ok: true, recoveryKeyText: KEY }));
		expect(s.title()).toBe("Add a way to get back in");
		// Back to the password: the keys are dropped and the fields are empty.
		await s.press("Back");
		expect(discard).toHaveBeenCalled();
		expect(s.find("field:New password")?.props.value).toBe("");
		expect(s.find("field:Confirm new password")?.props.value).toBe("");
	});

	it("keeps the person here with the failure words when the keys cannot be made", async () => {
		makeKeys.mockResolvedValue({ ok: false });
		const s = render();
		await s.press("Continue");
		s.type("New password", PASSWORD);
		s.type("Confirm new password", PASSWORD);
		await s.press("Continue");
		expect(s.title()).toBe("Set a new password");
		expect(s.texts()).toContain("Couldn't finish. Try again.");
		expect(s.disabled("Continue")).toBe(false);
	});
});

describe("EnableSheet, ways back in", () => {
	it("offers the recovery key now and the others with their reason", async () => {
		const s = render();
		await toMethods(s);
		expect(s.texts()).toEqual(
			expect.arrayContaining([
				"Recovery key",
				"Another device",
				"Trusted person",
			]),
		);
		expect(s.texts().filter((x) => x === "Not available yet")).toHaveLength(2);
		// Continue stays off until the key is saved and confirmed.
		expect(s.disabled("Continue")).toBe(true);
		expect(s.find("button:Create key")).toBeDefined();
	});
});

describe("EnableSheet, save the key", () => {
	it("shows the nine groups, copies the key and saves the file", async () => {
		const s = render();
		await toMethods(s);
		await s.press("Create key");
		expect(s.title()).toBe("Save your recovery key");
		for (const group of GROUPS) expect(s.texts()).toContain(group);
		expect(s.texts()).toContain("Group 9");

		await s.press("Copy");
		expect(mockCopy).toHaveBeenCalledWith(KEY);

		mockSave.mockResolvedValue(true);
		await s.press("Save to Files");
		expect(mockSave).toHaveBeenCalledTimes(1);
		const [labels, file] = mockSave.mock.calls[0] as [
			Record<string, string>,
			{ keyText: string; account: string },
		];
		expect(file).toEqual({ keyText: KEY, account: "ana@example.com" });
		expect(labels).toEqual({
			title: "Retrospend recovery key",
			account: "Account",
			made: "Made",
			key: "Recovery key",
			keepSafe:
				"Without this key or your password, nobody can open your data, including us.",
		});
	});

	it("says so when the file cannot be saved", async () => {
		const s = render();
		await toMethods(s);
		await s.press("Create key");
		mockSave.mockResolvedValue(false);
		await s.press("Save to Files");
		expect(s.texts()).toContain("Couldn't finish. Try again.");
		mockSave.mockRejectedValue(new Error("closed"));
		mockCopy.mockRejectedValue(new Error("no clipboard"));
		await s.press("Copy");
		expect(s.texts()).toContain("Couldn't finish. Try again.");
	});

	it("goes back to the ways without confirming", async () => {
		const s = render();
		await toMethods(s);
		await s.press("Create key");
		await s.press("Back");
		expect(s.title()).toBe("Add a way to get back in");
		expect(s.disabled("Continue")).toBe(true);
	});
});

describe("EnableSheet, confirm the key", () => {
	it("asks for two groups by number and refuses a wrong one", async () => {
		const s = render();
		await toConfirmKey(s);
		expect(s.title()).toBe("Confirm your key");
		expect(s.texts()).toContain("Type group 1 and group 2.");
		expect(s.disabled("Continue")).toBe(true);

		s.type("Group 1", GROUPS[0] as string);
		// The second group's neighbor, not the group.
		s.type("Group 2", GROUPS[2] as string);
		await s.press("Continue");
		expect(s.title()).toBe("Confirm your key");
		expect(s.texts()).toContain("Does not match");
		expect(
			(
				s.must("field:Group 2").props.accessibilityState as {
					invalid: boolean;
				}
			).invalid,
		).toBe(true);
		expect(
			(
				s.must("field:Group 1").props.accessibilityState as {
					invalid: boolean;
				}
			).invalid,
		).toBe(false);
	});

	it("reads a group the way the key is read, then marks the key done", async () => {
		const s = render();
		await toConfirmKey(s);
		// Lower case and a trailing space do not matter.
		s.type("Group 1", `${(GROUPS[0] as string).toLowerCase()} `);
		s.type("Group 2", GROUPS[1] as string);
		await s.press("Continue");
		expect(s.title()).toBe("Add a way to get back in");
		expect(s.texts()).toContain("Done");
		expect(s.find("button:Create key")).toBeUndefined();
		expect(s.disabled("Continue")).toBe(false);
	});

	it("draws two new groups after Back", async () => {
		const s = render();
		await toConfirmKey(s);
		expect(s.texts()).toContain("Type group 1 and group 2.");
		await s.press("Back");
		await s.press("I saved it");
		expect(s.texts()).not.toContain("Type group 1 and group 2.");
		expect(s.texts()).toContain("Type group 1 and group 3.");
	});
});

describe("EnableSheet, confirm it is you", () => {
	it("asks for the password only, and sends it with an empty code", async () => {
		const s = render();
		await toConfirmYou(s);
		expect(s.title()).toBe("Confirm it's you");
		expect(s.find("field:Authentication code")).toBeUndefined();
		expect(s.disabled("Save keys")).toBe(true);
		s.type("Password", "old password");
		await s.press("Save keys");
		expect(confirm).toHaveBeenCalledWith({
			password: "old password",
			code: "",
		});
	});

	it("also asks for the code when two-factor is on", async () => {
		const s = render({ twoFactor: true });
		await toConfirmYou(s);
		s.type("Password", "old password");
		expect(s.disabled("Save keys")).toBe(true);
		s.type("Authentication code", "123456");
		expect(s.disabled("Save keys")).toBe(false);
		await s.press("Save keys");
		expect(confirm).toHaveBeenCalledWith({
			password: "old password",
			code: "123456",
		});
	});

	it("waits for the whole six digit code, not any code", async () => {
		const s = render({ twoFactor: true });
		await toConfirmYou(s);
		s.type("Password", "old password");
		for (const short of ["1", "12345"]) {
			s.type("Authentication code", short);
			expect(s.disabled("Save keys")).toBe(true);
			await s.press("Save keys");
		}
		expect(confirm).not.toHaveBeenCalled();
		s.type("Authentication code", "123456");
		expect(s.disabled("Save keys")).toBe(false);
	});

	it("shows the busy state and ignores a second press", async () => {
		let release: (r: unknown) => void = () => undefined;
		confirm.mockReturnValue(new Promise((r) => (release = r)));
		const s = render();
		await toConfirmYou(s);
		s.type("Password", "old password");
		await s.press("Save keys");
		expect(s.disabled("Saving")).toBe(true);
		await s.press("Saving");
		expect(confirm).toHaveBeenCalledTimes(1);
		await act(async () => release({ ok: true }));
		expect(s.title()).toBe("Keys saved");
	});

	it.each([
		["wrongPassword", "Wrong password"],
		["wrongCode", "That code didn't work"],
		["tooMany", "Too many tries, wait a minute and try again."],
		["failed", "Couldn't finish. Try again."],
	] as const)(
		"keeps %s on the step and lets the person try again",
		async (reason, words) => {
			confirm.mockResolvedValue({ ok: false, reason });
			const s = render();
			await toConfirmYou(s);
			s.type("Password", "old password");
			await s.press("Save keys");
			expect(s.texts()).toContain(words);
			expect(s.title()).toBe("Confirm it's you");
			expect(s.disabled("Save keys")).toBe(false);
		},
	);

	it.each([
		["notOffered", "Advanced protection is not available here."],
		["checkFailed", "Couldn't check your keys."],
	] as const)(
		"ends on %s with the words and a way to close, not to retry",
		async (reason, words) => {
			confirm.mockResolvedValue({ ok: false, reason });
			const s = render();
			await toConfirmYou(s);
			s.type("Password", "old password");
			await s.press("Save keys");
			expect(s.texts()).toContain(words);
			expect(s.find("button:Save keys")).toBeUndefined();
			await s.press("Close");
			expect(onClose).toHaveBeenCalledTimes(1);
			expect(discard).toHaveBeenCalled();
		},
	);
});

describe("EnableSheet, the end", () => {
	async function toDone() {
		const s = render();
		await toConfirmYou(s);
		s.type("Password", "old password");
		await s.press("Save keys");
		return s;
	}

	it("shows the notice that the keys are ready and nothing is sealed yet", async () => {
		const s = await toDone();
		expect(s.title()).toBe("Keys saved");
		expect(s.texts()).toContain(
			"Your keys are ready. Your data is sealed when Advanced protection turns on.",
		);
		// Keys are set and protection stays off: nothing here says it is on.
		expect(s.texts().join(" ")).not.toMatch(/is on\b(?!\.)|turned on/i);
	});

	it("says Keys saved once, closes and drops the draft on Done", async () => {
		const s = await toDone();
		expect(mockToast.show).not.toHaveBeenCalled();
		discard.mockClear();
		await s.press("Done");
		expect(mockToast.show).toHaveBeenCalledWith({ message: "Keys saved" });
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(discard).toHaveBeenCalled();
	});
});

describe("EnableSheet, nothing stays in a closed sheet", () => {
	it("drops the draft when closed on the way", async () => {
		const s = render();
		await toMethods(s);
		discard.mockClear();
		await act(async () => {
			(s.must("sheet-close").props.onPress as () => void)();
		});
		expect(discard).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("starts again from the first step with empty fields when opened again", async () => {
		const s = render();
		await toMethods(s);
		await s.press("Create key");
		s.setVisible(false);
		expect(discard).toHaveBeenCalled();
		s.setVisible(true);
		expect(s.title()).toBe("Turn on Advanced protection");
		await s.press("Continue");
		expect(s.find("field:New password")?.props.value).toBe("");
		await s.press("Back");
		await s.press("Continue");
		// The old key text is gone: Back through the steps never shows it.
		expect(s.texts()).not.toContain(GROUPS[0]);
	});

	it("ignores a run that finishes after the sheet was closed", async () => {
		let release: (r: unknown) => void = () => undefined;
		makeKeys.mockReturnValue(new Promise((r) => (release = r)));
		const s = render();
		await s.press("Continue");
		s.type("New password", PASSWORD);
		s.type("Confirm new password", PASSWORD);
		await s.press("Continue");
		s.setVisible(false);
		s.setVisible(true);
		discard.mockClear();
		await act(async () => release({ ok: true, recoveryKeyText: KEY }));
		// The adapter was handed a fresh draft by the late answer: drop it.
		expect(discard).toHaveBeenCalledTimes(1);
		expect(s.title()).toBe("Turn on Advanced protection");
		expect(s.texts()).not.toContain(GROUPS[0]);
	});
});

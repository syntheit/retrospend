import type { ReactElement } from "react";
import {
	act,
	flush,
	mount,
	type TestNode,
	type Tree,
	textOf,
	words,
	world,
} from "../../../../test/harness";
import { useProtectionRow } from "./useProtectionRow";

// The Security row's view states: hidden until the server says it offers
// protection (a flag that has not loaded, or is off, or fails to load, shows
// nothing), then loading, could not load with Try again, off, off with the
// email unverified, and keys ready. Turning on opens the enable sheet; the row
// reads again when it closes.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/crypto/native", () => ({ getPrimitives: jest.fn() }));
jest.mock("@/lib/secure-store", () => ({ secureStore: {} }));
const mockCallbacks = { makeKeys: jest.fn(), save: jest.fn() };
jest.mock("@/auth/enable", () => ({
	phoneEnableCallbacks: jest.fn(() => mockCallbacks),
}));
const mockSheet = jest.fn();
jest.mock("./EnableSheet", () => ({
	EnableSheet: (props: Record<string, unknown>) => {
		mockSheet(props);
		return null;
	},
}));
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));
const mockNewKeyCallbacks = { makeKey: jest.fn(), save: jest.fn() };
const mockNewKeyFactory = jest.fn(() => mockNewKeyCallbacks);
jest.mock("@/auth/new-key", () => ({
	phoneNewKeyCallbacks: (...a: unknown[]) =>
		(mockNewKeyFactory as (...a: unknown[]) => unknown)(...a),
}));
const mockNewKeySheet = jest.fn();
jest.mock("./NewKeySheet", () => ({
	NewKeySheet: (props: Record<string, unknown>) => {
		mockNewKeySheet(props);
		return null;
	},
}));

type Answer<T> = () => Promise<T>;
function setApi(over: {
	info?: Answer<{ features: { advancedProtection: boolean } }>;
	keys?: Answer<unknown>;
}) {
	world.api = {
		platform: {
			serverInfo:
				over.info ?? (async () => ({ features: { advancedProtection: true } })),
		},
		protection: { keys: over.keys ?? (async () => ({ version: 1 })) },
	} as never;
}
const missing = () => Object.assign(new Error("x"), { status: 404 });

function Probe(): ReactElement {
	const { row, sheet } = useProtectionRow();
	return (
		<>
			{row}
			{sheet}
		</>
	);
}

/** The pressable whose words are `label`. */
const button = (tree: Tree, label: string) =>
	tree.root.findAll(
		(n) =>
			typeof n.props.onPress === "function" &&
			n.props.accessibilityRole === "button" &&
			textOf(n).startsWith(label),
	)[0];

const tap = (node: TestNode | undefined) => {
	if (!node) throw new Error("nothing to press");
	(node.props.onPress as () => void)();
};

async function show(): Promise<Tree> {
	const tree = await mount(<Probe />);
	await flush();
	return tree;
}

const setMe = (over: Record<string, unknown> = {}) => {
	world.me = {
		...world.me,
		email: "ana@example.com",
		emailVerified: true,
		twoFactorEnabled: false,
		...over,
	} as never;
};

beforeEach(() => {
	mockSheet.mockClear();
	mockNewKeySheet.mockClear();
	mockNewKeyFactory.mockClear();
	setMe();
});

describe("the Advanced protection row", () => {
	it("shows nothing when the server does not offer it", async () => {
		setApi({ info: async () => ({ features: { advancedProtection: false } }) });
		const tree = await show();
		expect(words(tree)).toBe("");
		expect(mockSheet).not.toHaveBeenCalled();
	});

	it("shows nothing when the flags cannot be read", async () => {
		setApi({
			info: async () => {
				throw new Error("offline");
			},
		});
		expect(words(await show())).toBe("");
	});

	it("shows nothing before the flags have answered", async () => {
		setApi({ info: () => new Promise(() => {}) });
		expect(words(await mount(<Probe />))).toBe("");
	});

	it("shows nothing without an api", async () => {
		world.api = undefined;
		expect(words(await show())).toBe("");
	});

	it("shows a skeleton while the keys status loads, with no words about keys", async () => {
		setApi({ keys: () => new Promise(() => {}) });
		const text = words(await show());
		expect(text).toContain("Advanced protection");
		expect(text).not.toContain("Turn on");
		expect(text).not.toContain("Keys ready");
	});

	it("says it could not load and offers Try again, which asks again", async () => {
		let fail = true;
		setApi({
			keys: async () => {
				if (fail) throw Object.assign(new Error("x"), { status: 500 });
				throw missing();
			},
		});
		const tree = await show();
		expect(words(tree)).toContain("Couldn't load");
		fail = false;
		await act(async () => tap(button(tree, "Try again")));
		expect(words(tree)).toContain("Turn on");
	});

	it("is Off with Turn on for an account without keys, and Turn on opens the sheet", async () => {
		setApi({
			keys: async () => {
				throw missing();
			},
		});
		const tree = await show();
		const text = words(tree);
		expect(text).toContain("Off");
		expect(text).toContain("Turn on");
		const props = () => mockSheet.mock.calls.at(-1)?.[0];
		expect(props()).toMatchObject({
			visible: false,
			account: "ana@example.com",
			twoFactor: false,
		});
		const row = button(tree, "Advanced protection");
		act(() => tap(row));
		expect(props()?.visible).toBe(true);
	});

	it("passes two-factor to the sheet", async () => {
		setMe({ twoFactorEnabled: true });
		setApi({
			keys: async () => {
				throw missing();
			},
		});
		await show();
		expect(mockSheet.mock.calls.at(-1)?.[0]).toMatchObject({ twoFactor: true });
	});

	it("gives the reason and no Turn on when the email is not verified", async () => {
		setMe({ emailVerified: false });
		setApi({
			keys: async () => {
				throw missing();
			},
		});
		const text = words(await show());
		expect(text).toContain("Verify your email first");
		expect(text).not.toContain("Turn on");
	});

	it("says keys are ready, with nothing to turn on", async () => {
		setApi({});
		const text = words(await show());
		expect(text).toContain("Keys ready");
		expect(text).not.toContain("Turn on");
	});

	it("offers Make new key on keys ready, which opens the Make new key sheet for this account", async () => {
		setApi({});
		const tree = await show();
		const props = () => mockNewKeySheet.mock.calls.at(-1)?.[0];
		expect(props()).toMatchObject({
			visible: false,
			account: "ana@example.com",
		});
		expect(mockNewKeyFactory).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "me1" }),
			expect.anything(),
		);
		act(() => tap(button(tree, "Make new key")));
		expect(props()?.visible).toBe(true);
		act(() => (props()?.onClose as () => void)());
		expect(props()?.visible).toBe(false);
	});

	it("offers no Make new key before there are keys", async () => {
		setApi({
			keys: async () => {
				throw missing();
			},
		});
		expect(words(await show())).not.toContain("Make new key");
	});
});

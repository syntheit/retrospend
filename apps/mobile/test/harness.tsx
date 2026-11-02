import type { RetrospendClient } from "@retrospend/api-client";
import type { ReactElement } from "react";
import { IntlProvider } from "use-intl";
import { createReadCache, type ReadCache } from "@/data/cache";
import { createOutbox, type Outbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { loadMessages } from "@/lib/i18n";

// The shared harness of the press-level and hook tests (not a test itself).
// Import it FIRST in a test file: it registers the mocks that every test of a
// composer or a sheet needs (the session, the toast, client ids, the format
// locale, the network and the safe area), so a file does not repeat them.
//
// - The translator is the real one, over the real English catalog: `mount`
//   and `renderHook` wrap in a real IntlProvider, so a missing key shows up.
// - The theme is the real one (it reads the color scheme).
// - Native widgets with no JS (sheets, menus, pickers) have stand-ins in
//   ./native, which a file opts into with
//   `jest.mock("@/ui/Sheet", () => require("<path>/test/native").sheetMock)`.
//
// State the mocks read lives on `world`; `beforeEach` below resets it, and
// `afterEach` unmounts what a test mounted.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

export interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	children: (TestNode | string)[];
	findAll(match: (node: TestNode) => boolean): TestNode[];
}
export interface Tree {
	root: TestNode;
	unmount(): void;
}

export interface Local {
	cache: ReadCache;
	outbox: Outbox;
}

/** A fresh in-memory cache and outbox for one account. */
export function makeLocal(scope = "https://example.test|me1"): Local {
	const store = createMemoryStore();
	return {
		cache: createReadCache(store, scope),
		outbox: createOutbox(store, scope),
	};
}

export const defaultMe = () => ({
	id: "me1",
	name: "Sofía Reyes",
	homeCurrency: "ARS",
	defaultCurrency: "ARS",
});

const DEFAULT_ID = "00000000-0000-4000-8000-";

function freshWorld() {
	let counter = 0;
	return {
		/** The client `useSession().api`; undefined is a session with no server yet. */
		api: undefined as RetrospendClient | undefined,
		local: makeLocal(),
		me: defaultMe(),
		/** The number format locale (`useFormatLocale`). */
		locale: "en-US",
		/** `isInternetReachable` of the network state. */
		reachable: true as boolean | null,
		toast: { show: jest.fn(), dismiss: jest.fn() },
		/** Client ids: a counter by default; a test may fix one. */
		nextId: () => `${DEFAULT_ID}${String(++counter).padStart(12, "0")}`,
	};
}

export const world = freshWorld();

/** The latest toast shown: the message and its Undo. */
export function lastToast(): {
	message: string;
	undo?: { label: string; onUndo: () => void | Promise<void> };
} {
	const call = world.toast.show.mock.calls.at(-1);
	if (!call) throw new Error("no toast was shown");
	return call[0];
}

jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: mockWorld().api,
		local: mockWorld().local,
		state: {
			status: "signedIn",
			me: mockWorld().me,
			offline: false,
			offlineSince: null,
		},
	}),
}));
jest.mock("@/ui/Toast", () => ({ useToast: () => mockWorld().toast }));
jest.mock("@/data/ids", () => ({ newClientId: () => mockWorld().nextId() }));
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => mockWorld().locale }));
jest.mock("expo-network", () => ({
	useNetworkState: () => ({ isInternetReachable: mockWorld().reachable }),
}));
jest.mock("react-native-safe-area-context", () =>
	require("react-native-safe-area-context/jest/mock").default,
);

// jest.mock factories may only name variables that start with "mock".
function mockWorld() {
	return world;
}

beforeEach(() => {
	Object.assign(world, freshWorld());
});

const mounted = new Set<Tree>();
afterEach(() => {
	for (const tree of mounted) act(() => tree.unmount());
	mounted.clear();
});

/** Renders under the real translator and the English catalog; unmounts after the test. */
export async function mount(ui: ReactElement): Promise<Tree> {
	let tree!: Tree;
	await act(async () => {
		tree = create(
			<IntlProvider locale="en" messages={loadMessages("en")}>
				{ui}
			</IntlProvider>,
		);
	});
	mounted.add(tree);
	return tree;
}

/** Runs a hook under the same providers; `result.current` is its latest return. */
export async function renderHook<Result, Props = void>(
	use: (props: Props) => Result,
	initial?: Props,
) {
	const result = { current: undefined as Result };
	function Probe({ props }: { props: Props }) {
		result.current = use(props);
		return null;
	}
	const element = (props: Props) => (
		<IntlProvider locale="en" messages={loadMessages("en")}>
			<Probe props={props} />
		</IntlProvider>
	);
	let tree!: { update(element: ReactElement): void; unmount(): void };
	await act(async () => {
		tree = create(element(initial as Props));
	});
	const handle = {
		unmount: () => act(() => tree.unmount()),
	};
	mounted.add(handle as unknown as Tree);
	return {
		result,
		rerender: (props: Props) =>
			act(async () => {
				tree.update(element(props));
			}),
		unmount: handle.unmount,
	};
}

export const flush = () => act(async () => {});

export const wait = (ms: number) =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});

export const find = (
	tree: Tree,
	match: (props: Record<string, unknown>) => boolean,
) => tree.root.findAll((node) => match(node.props));

/** Presses the control whose accessibility label is `label`. */
export function press(tree: Tree, label: string) {
	const hit = find(
		tree,
		(p) => p.accessibilityLabel === label && typeof p.onPress === "function",
	)[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	act(() => {
		(hit.props.onPress as () => void)();
	});
}

/** Presses `label` and waits for what its handler awaits (a save, a write). */
export function pressAsync(tree: Tree, label: string) {
	const hit = find(
		tree,
		(p) => p.accessibilityLabel === label && typeof p.onPress === "function",
	)[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	return act(async () => {
		(hit.props.onPress as () => void)();
	});
}

/** Presses the control whose label starts with `prefix` (a row that adds its detail to its name). */
export function pressStarting(tree: Tree, prefix: string) {
	const hit = find(
		tree,
		(p) =>
			typeof p.accessibilityLabel === "string" &&
			p.accessibilityLabel.startsWith(prefix) &&
			typeof p.onPress === "function",
	)[0];
	if (!hit) throw new Error(`nothing to press: ${prefix}`);
	act(() => {
		(hit.props.onPress as () => void)();
	});
}

/** Types into the field whose accessibility label is `label`. */
export function type(tree: Tree, label: string, text: string) {
	const hit = find(
		tree,
		(p) =>
			p.accessibilityLabel === label && typeof p.onChangeText === "function",
	)[0];
	if (!hit) throw new Error(`nothing to type in: ${label}`);
	act(() => {
		(hit.props.onChangeText as (text: string) => void)(text);
	});
}

/** Whether the control labeled `label` is disabled. */
export function disabled(tree: Tree, label: string): boolean {
	const hit = find(tree, (p) => p.accessibilityLabel === label)[0];
	if (!hit) throw new Error(`nothing found: ${label}`);
	return (
		(hit.props.accessibilityState as { disabled?: boolean } | undefined)
			?.disabled === true
	);
}

/** The words under a node, joined. */
export function textOf(node: TestNode | string): string {
	if (typeof node === "string") return node;
	return node.children.map(textOf).join("");
}

/** Every string the screen shows (the formatter's no-break space as a plain one). */
export function words(tree: Tree): string {
	const out: string[] = [];
	const walk = (node: TestNode | string) => {
		if (typeof node === "string") out.push(node);
		else for (const child of node.children) walk(child);
	};
	walk(tree.root);
	return out.join(" ").replaceAll(" ", " ");
}

export { act };

import { Pressable } from "react-native";

// Shared pieces of the sheet tests (not a test itself): the mocks every
// press-level test of a money sheet needs, and the helpers that press and
// wait. A test file wires them with `jest.mock(path, () => require("./harness").x)`.
const renderer = require("react-test-renderer");
const { act } = renderer;

export interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}
export interface Tree {
	root: TestNode;
	unmount(): void;
}

export const session: { api: unknown } = { api: undefined };
export const sessionMock = { useSession: () => ({ api: session.api }) };

export const ids = { counter: 0 };
export const idsMock = {
	newClientId: () =>
		`00000000-0000-4000-8000-${String(++ids.counter).padStart(12, "0")}`,
};

export const toast = { show: jest.fn(), dismiss: jest.fn() };
export const toastMock = { useToast: () => toast };

function HarnessButton({ label, onPress, disabled }: Record<string, unknown>) {
	return (
		<Pressable
			accessibilityLabel={label as string}
			accessibilityState={{ disabled: Boolean(disabled) }}
			onPress={disabled ? undefined : (onPress as () => void)}
		/>
	);
}
export const buttonMock = { Button: HarnessButton };

function HarnessSheet({ visible, children }: Record<string, unknown>) {
	return visible ? (children as never) : null;
}
export const sheetMock = { Sheet: HarnessSheet };

function HarnessSegmented({
	options,
	onChange,
}: {
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
}) {
	return options.map((o) => (
		<Pressable
			accessibilityLabel={o.label}
			key={o.value}
			onPress={() => onChange(o.value)}
		/>
	));
}
export const segmentedMock = { Segmented: HarnessSegmented };

function HarnessSwitchRow({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange: (v: boolean) => void;
	value: boolean;
}) {
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityState={{ selected: value }}
			onPress={() => onChange(!value)}
		/>
	);
}
export const switchMock = { SwitchRow: HarnessSwitchRow };

export const intlMock = (() => {
	const { loadMessages } = require("@/lib/i18n");
	const messages = loadMessages("en");
	const lookup = (ns: string | undefined, key: string) =>
		(ns ? `${ns}.${key}` : key)
			.split(".")
			// biome-ignore lint/suspicious/noExplicitAny: a walk over the JSON tree
			.reduce((node: any, part: string) => node?.[part], messages);
	return {
		useTranslations: (ns?: string) => {
			const t = (key: string, values: Record<string, unknown> = {}) =>
				String(lookup(ns, key) ?? key).replace(/\{(\w+)\}/g, (_, name) =>
					String(values[name]),
				);
			t.has = (key: string) => lookup(ns, key) !== undefined;
			return t;
		},
		useFormatter: () => ({
			number: (n: number) => String(n),
			dateTime: () => "Oct 1, 2026",
		}),
	};
})();

export const wait = (ms: number) =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});

/** `label` matches exactly, or as a prefix when it ends with a comma (a row also says its figure). */
export function press(tree: Tree, label: string) {
	const hits = tree.root.findAll(
		(n) =>
			(n.props.accessibilityLabel === label ||
				(label.endsWith(",") &&
					String(n.props.accessibilityLabel).startsWith(label))) &&
			typeof n.props.onPress === "function",
	);
	const hit = label.endsWith(",") ? hits[hits.length - 1] : hits[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	act(() => {
		(hit.props.onPress as () => void)();
	});
}

export const disabled = (tree: Tree, label: string) =>
	(
		tree.root.findAll((n) => n.props.accessibilityLabel === label)[0]?.props
			.accessibilityState as { disabled: boolean } | undefined
	)?.disabled;

export interface Call {
	route: string;
	input: unknown;
	key?: string;
}

/** A fake budget client: reads answer from `reads`, previews answer empty, writes answer an undo token. */
export function fakeBudget(options: {
	reads?: Record<string, unknown>;
	previews?: string[];
	writes?: string[];
	undo?: string | null;
	extra?: Record<string, unknown>;
}) {
	const calls: Call[] = [];
	const budget: Record<string, unknown> = {};
	for (const [name, out] of Object.entries(options.reads ?? {})) {
		budget[name] = async (input: unknown) => {
			calls.push({ route: name, input });
			return out;
		};
	}
	for (const name of options.previews ?? []) {
		budget[name] = async (input: unknown) => {
			calls.push({ route: name, input });
			return {
				changes: [],
				unchanged: [],
				unavailable: [],
				detail: { kind: "x", result: {} },
			};
		};
	}
	for (const name of options.writes ?? []) {
		budget[name] = async (
			input: unknown,
			init?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({ route: name, input, key: init?.context?.idempotencyKey });
			return { result: {}, undo: options.undo ?? "undo-token-1" };
		};
	}
	budget.undo = async (input: unknown) => {
		calls.push({ route: "undo", input });
		return { result: {}, redo: null };
	};
	Object.assign(budget, options.extra ?? {});
	return { api: { budget }, calls };
}

/** Presses the toast's Undo and returns once it ran. */
export async function undoFromToast() {
	const shown = toast.show.mock.calls[0]?.[0] as
		| { undo?: { onUndo: () => Promise<void> } }
		| undefined;
	await act(async () => {
		await shown?.undo?.onUndo();
	});
}

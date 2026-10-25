import type { RetrospendClient } from "@retrospend/api-client";
import { createReadCache } from "@/data/cache";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import type { EntryMode } from "./ComposerShell";
import { EntryComposer } from "./EntryComposer";
import { forgetUndoTokens } from "./send";

// The composer end to end, with real presses on its real components: the
// milestone "coffee split with Lucía in 4 taps + 5 keys". The tab press that
// opens the composer is the first tap, so the composer itself takes three
// presses and five keys. jest-expo ships react-test-renderer without
// exposing it to the app, so it is resolved through jest-expo.
const renderer = require(
	require.resolve("react-test-renderer", {
		paths: [require.resolve("jest-expo/package.json")],
	}),
);
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	children: (TestNode | string)[];
	findAll(match: (node: TestNode) => boolean): TestNode[];
}
interface Tree {
	root: TestNode;
	unmount(): void;
}

const mockMe = {
	id: "me1",
	homeCurrency: "ARS",
	defaultCurrency: "ARS",
	name: "Sofía Reyes",
};
const scope = "https://example.test|me1";
const store = createMemoryStore();
const local = {
	cache: createReadCache(store, scope),
	outbox: createOutbox(store, scope),
};
const mockSession: { api: unknown; local: unknown } = {
	api: undefined,
	local,
};

jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: mockSession.api,
		local: mockSession.local,
		state: { status: "signedIn", me: mockMe },
	}),
}));
jest.mock("@/data/ids", () => ({
	newClientId: () => "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11",
}));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
// The native pickers have no JS to press; the flow uses chips and keys only.
jest.mock("@/ui/Menu", () => ({ Menu: () => null }));
jest.mock("@/ui/Segmented", () => ({ Segmented: () => null }));
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
// use-intl ships untranspiled ES modules the jest preset does not transform;
// this stand-in reads the real English catalog, so a missing key shows up.
jest.mock("use-intl", () => {
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
	};
});

const page = <T,>(items: T[]) => ({ items, nextCursor: null });
const category = (id: string, name: string, uses: number) => ({
	id,
	name,
	color: "amber",
	icon: null,
	excludeByDefault: false,
	expenseCount: uses,
});

const money = (minor: number) => ({ minor, currency: "ARS" });
// The dry run of ARS 3,000 with Use my plan, as the server answers it.
const planPreview = {
	changes: [
		{
			id: "budget.notPlannedYet",
			currency: "ARS",
			before: money(0),
			after: money(34_000_000),
			delta: money(34_000_000),
			figureAfter: [money(34_000_000)],
		},
	],
	unchanged: [{ id: "spent", lines: [money(5_000_000)] }],
	unavailable: [],
};

function fakeApi() {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const write =
		(route: string, result: (input: unknown) => unknown = () => ({})) =>
		async (
			input: unknown,
			options?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({ route, input, key: options?.context?.idempotencyKey });
			return result(input);
		};
	const api = {
		categories: {
			list: async () =>
				page([
					category("cafe", "Cafe", 46),
					category("groceries", "Groceries", 15),
				]),
		},
		people: {
			list: async () => ({
				people: [
					{
						person: {
							key: "user:lucia1",
							type: "user",
							id: "lucia1",
							name: "Lucía Fernández",
							imageUrl: null,
						},
						lastShared: { date: "2026-10-20" },
					},
				],
			}),
		},
		currencies: {
			list: async () => page([{ code: "ARS", rateTypes: ["official"] }]),
		},
		budget: { verdict: async () => ({ style: "FLEX" }) },
		expenses: {
			create: write("expenses.create", () => ({ undo: "undo-expense" })),
		},
		"shared-expenses": {
			previewCreate: write("shared.preview", () => ({
				changes: [],
				unchanged: [],
				unavailable: [],
			})),
			create: write("shared.create", () => ({ undo: "undo-shared" })),
			undo: write("shared.undo"),
		},
		income: {
			previewCreate: write("income.preview", () => planPreview),
			create: write("income.create", () => ({ undo: "undo-income" })),
			undo: write("income.undo"),
		},
	} as unknown as RetrospendClient;
	return { api, calls };
}

const flush = () => act(async () => {});

async function open(mode: EntryMode, onDone: () => void = () => {}) {
	let tree!: Tree;
	await act(async () => {
		tree = create(<EntryComposer initialMode={mode} onDone={onDone} />);
	});
	await flush();
	return tree;
}

const find = (tree: Tree, match: (props: Record<string, unknown>) => boolean) =>
	tree.root.findAll((node) => match(node.props));

function press(tree: Tree, label: string) {
	const hit = find(
		tree,
		(p) => p.accessibilityLabel === label && typeof p.onPress === "function",
	)[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	act(() => {
		(hit.props.onPress as () => void)();
	});
}

function type(tree: Tree, label: string, text: string) {
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

/** Every string the screen shows. */
function words(tree: Tree): string {
	const out: string[] = [];
	const walk = (node: TestNode | string) => {
		if (typeof node === "string") out.push(node);
		else for (const child of node.children) walk(child);
	};
	walk(tree.root);
	// The formatter joins a code and its number with a no-break space.
	return out.join(" ").replaceAll("\u00a0", " ");
}

/** Past the 350 ms the dry run waits for typing to stop, and its answer. */
async function settle() {
	await act(async () => {
		jest.advanceTimersByTime(400);
	});
	await flush();
}

beforeEach(async () => {
	// Every test makes the same client id, so nothing may carry over.
	forgetUndoTokens();
	await local.outbox.clear();
	jest.useFakeTimers();
	mockToast.show.mockClear();
});
afterEach(() => jest.useRealTimers());

describe("Add expense: coffee split with Lucía", () => {
	it("takes the composer three taps and five keys, and writes through the outbox", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done);

		const taps = ["Cafe", "Lucía Fernández", "Add expense"];
		const keys = ["1", "2", "5", "0", "0"];
		press(tree, taps[0] as string);
		press(tree, taps[1] as string);
		for (const key of keys) press(tree, key);
		await act(async () => {
			jest.advanceTimersByTime(400);
		});
		await flush();
		// The split rows are on screen before Save.
		expect(words(tree)).toContain("Split equally");
		expect(words(tree)).toContain("ARS 6,250");
		press(tree, taps[2] as string);
		await flush();

		// The tab press that opened the composer is the fourth tap.
		expect(taps).toHaveLength(3);
		expect(keys).toHaveLength(5);
		const sent = calls.find((c) => c.route === "shared.create");
		expect(sent).toEqual({
			route: "shared.create",
			key: "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11",
			input: {
				id: "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11",
				description: "Cafe",
				amount: "12500.00",
				currency: "ARS",
				date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				categoryId: "cafe",
				paidBy: { type: "user", id: "me1" },
				splitMode: "EQUAL",
				splitWith: [
					{ type: "user", id: "me1" },
					{ type: "user", id: "lucia1" },
				],
			},
		});
		expect(done).toHaveBeenCalledTimes(1);
		expect(mockToast.show).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Added Cafe",
				undo: expect.objectContaining({ label: "Undo" }),
			}),
		);
		act(() => tree.unmount());
	});

	it("asks for the missing amount and category instead of saving", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Add expense");
		await flush();
		expect(words(tree)).toContain("Enter an amount above zero");
		expect(words(tree)).toContain("Pick a category");
		expect(calls.filter((c) => c.route.endsWith(".create"))).toEqual([]);
		act(() => tree.unmount());
	});

	it("keeps the write on the phone when the server can not be reached", async () => {
		const { api } = fakeApi();
		const shared = (api as unknown as Record<string, { create: unknown }>)[
			"shared-expenses"
		] as { create: unknown };
		shared.create = async () => {
			throw new TypeError("Network request failed");
		};
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Cafe");
		press(tree, "Lucía Fernández");
		for (const key of ["9", "0", "0"]) press(tree, key);
		await settle();
		press(tree, "Add expense");
		await flush();
		const waiting = await local.outbox.all();
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({ entity: "shared-expenses" });
		expect(mockToast.show).toHaveBeenLastCalledWith(
			expect.objectContaining({
				message: "Saved Cafe on this phone. It syncs when you're online.",
			}),
		);
		act(() => tree.unmount());
	});
});

describe("Add income with Use my plan", () => {
	it("shows what changes before Save, writes usePlan and undoes through the server", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("income");
		type(tree, "From", "Grupo Andino");
		for (const key of ["3", "0", "0", "0"]) press(tree, key);
		await act(async () => {
			jest.advanceTimersByTime(400);
		});
		await flush();

		// The dry run is the real write's dry run: same body, with the plan on.
		const preview = calls.find((c) => c.route === "income.preview");
		expect(preview?.input).toMatchObject({
			title: "Grupo Andino",
			amount: "3000.00",
			currency: "ARS",
			usePlan: true,
		});
		expect(words(tree)).toContain("What this changes");
		expect(words(tree)).toContain("Not planned yet");
		expect(words(tree)).toContain("+ARS 340,000");
		expect(words(tree)).toContain("to ARS 340,000");
		expect(words(tree)).toContain("Stays the same: your spending.");

		press(tree, "Add income");
		await flush();
		expect(calls.find((c) => c.route === "income.create")?.input).toMatchObject(
			{
				id: "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11",
				title: "Grupo Andino",
				amount: "3000.00",
				usePlan: true,
			},
		);
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		expect(toast.message).toBe("Added Grupo Andino");
		await act(async () => {
			toast.undo.onUndo();
		});
		await flush();
		expect(calls.at(-1)).toEqual({
			route: "income.undo",
			input: { token: "undo-income" },
			key: "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11-undo",
		});
		act(() => tree.unmount());
	});

	it("asks who paid you and leaves the plan off without an envelope budget", async () => {
		const { api, calls } = fakeApi();
		(api as unknown as { budget: { verdict: unknown } }).budget.verdict =
			async () => null;
		mockSession.api = api;
		const tree = await open("income");
		for (const key of ["5", "0", "0"]) press(tree, key);
		press(tree, "Add income");
		await flush();
		expect(words(tree)).toContain("Say who paid you");
		type(tree, "From", "Estudio Norte");
		await act(async () => {
			jest.advanceTimersByTime(400);
		});
		await flush();
		const preview = calls.find((c) => c.route === "income.preview");
		expect(preview?.input).toMatchObject({ usePlan: false });
		act(() => tree.unmount());
	});
});

describe("Save waits for the dry run of what it will send", () => {
	const fill = (tree: Tree) => {
		press(tree, "Cafe");
		press(tree, "Lucía Fernández");
		for (const key of ["9", "0", "0"]) press(tree, key);
	};
	const creates = (calls: { route: string }[]) =>
		calls.filter((c) => c.route.endsWith(".create"));

	it("does not send while the preview is on its way", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		fill(tree);
		press(tree, "Add expense");
		await flush();
		expect(creates(calls)).toEqual([]);
		await settle();
		press(tree, "Add expense");
		await flush();
		expect(creates(calls)).toHaveLength(1);
		act(() => tree.unmount());
	});

	it("says No rate yet and does not save when the currency has no rate", async () => {
		const { api, calls } = fakeApi();
		(api as unknown as Record<string, { previewCreate: unknown }>)[
			"shared-expenses"
		]!.previewCreate = async () => {
			throw Object.assign(new Error("No rate for ARS"), {
				status: 422,
				code: "missing_rate",
			});
		};
		mockSession.api = api;
		const tree = await open("expense");
		fill(tree);
		await settle();
		expect(words(tree)).toContain(
			"No rate yet for ARS. Pick another currency.",
		);
		press(tree, "Add expense");
		await flush();
		expect(creates(calls)).toEqual([]);
		act(() => tree.unmount());
	});

	it("saves on the phone when the dry run can not be reached", async () => {
		const { api, calls } = fakeApi();
		(api as unknown as Record<string, { previewCreate: unknown }>)[
			"shared-expenses"
		]!.previewCreate = async () => {
			throw new TypeError("Network request failed");
		};
		mockSession.api = api;
		const tree = await open("expense");
		fill(tree);
		await settle();
		expect(words(tree)).toContain("You're offline.");
		press(tree, "Add expense");
		await flush();
		expect(creates(calls)).toHaveLength(1);
		act(() => tree.unmount());
	});
});

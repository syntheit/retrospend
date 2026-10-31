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
// presses and five keys. react-test-renderer is a dev dependency of the app.
const renderer = require("react-test-renderer");
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
const mockNet: { isInternetReachable: boolean | null } = {
	isInternetReachable: true,
};
jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
// The native pickers have no JS to press; the flow uses chips and keys only.
jest.mock("@/ui/CurrencyPicker", () => ({ CurrencyPicker: () => null }));
jest.mock("./CategoryPicker", () => ({ CategoryPicker: () => null }));
jest.mock("@/ui/Segmented", () => ({ Segmented: () => null }));
// The sheet shows its body and footer while it is visible.
jest.mock("@/ui/Sheet", () => ({
	// biome-ignore lint/suspicious/noExplicitAny: a stand-in for a native sheet
	Sheet: ({ visible, children, footer }: any) =>
		visible ? [children, footer] : null,
}));
// The system menu's items as plain buttons, so a test can pick from it.
jest.mock("@/ui/Menu", () => {
	const { Pressable } = require("react-native");
	const React = require("react");
	return {
		// biome-ignore lint/suspicious/noExplicitAny: a stand-in for a native menu
		Menu: ({ items }: any) =>
			// biome-ignore lint/suspicious/noExplicitAny: a stand-in for a native menu
			items.map((item: any) =>
				React.createElement(Pressable, {
					key: item.id,
					accessibilityLabel: item.label,
					onPress: item.onPress,
				}),
			),
	};
});
// The sheet's rows as plain buttons, so a test can pick from it.
jest.mock("@/ui/PickerSheet", () => {
	const { Pressable } = require("react-native");
	const React = require("react");
	return {
		// biome-ignore lint/suspicious/noExplicitAny: a stand-in for a native sheet
		PickerSheet: ({ visible, groups, onSelect }: any) =>
			visible
				? // biome-ignore lint/suspicious/noExplicitAny: a stand-in for a native sheet
					groups.flatMap((g: any) =>
						// biome-ignore lint/suspicious/noExplicitAny: a stand-in for a native sheet
						g.rows.map((r: any) =>
							React.createElement(Pressable, {
								key: r.id,
								accessibilityLabel: `pick ${r.label}`,
								onPress: () => onSelect(r.id),
							}),
						),
					)
				: null,
	};
});
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
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
		useFormatter: () => ({ dateTime: (d: Date) => d.toDateString() }),
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
	tone: 3,
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
	// What Use my plan would assign, from the same dry run.
	detail: {
		kind: "income.add",
		plan: {
			applied: true,
			reason: null,
			lines: [{ envelopeId: "rent", amount: money(25_000_000), step: "PLAN" }],
			rest: money(9_000_000),
		},
	},
};

/** What the server says before it would preview a split delete that erases a debt. */
let sharedDeleteWarning: string | null = null;

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
		budget: {
			verdict: async () => ({ style: "FLEX" }),
			month: async () => ({
				groups: [{ envelopes: [{ id: "rent", name: "Rent" }] }],
			}),
		},
		entry: {
			// USD in an ARS home: two types, each booked at the amount asked.
			rateOptions: write("entry.rateOptions", (input) => {
				const { amount, customRate } = input as {
					amount?: string;
					customRate?: string;
				};
				const unit = { minor: 100, currency: "USD" };
				const at = (rate: number) => ({
					rate: { unit, value: money(rate * 100) },
					home: amount ? money(Number(amount) * rate * 100) : null,
				});
				return {
					homeCurrency: "ARS",
					defaultType: "blue",
					options: [
						{ rateType: "official", ...at(1050) },
						{ rateType: "blue", ...at(1465) },
					],
					missing: null,
					custom: customRate
						? { rateType: "custom", ...at(Number(customRate)) }
						: null,
				};
			}),
			catalog: async () => ({
				places: [
					{ id: "cash", name: "Cash", type: "CASH", currency: "ARS" },
					{ id: "bank", name: "Bank", type: "CHECKING", currency: "ARS" },
				],
			}),
		},
		projects: {
			list: async () => ({
				items: [
					{
						id: "trip",
						name: "Trip",
						status: "ACTIVE",
						myRole: "EDITOR",
						imageUrl: null,
						currency: "ARS",
						peopleCount: 3,
					},
					{
						id: "club",
						name: "Club",
						status: "ACTIVE",
						myRole: "VIEWER",
						imageUrl: null,
						currency: "ARS",
						peopleCount: 9,
					},
				],
			}),
			members: write("projects.members", () => ({
				items: [
					{ participantType: "user", participantId: "me1", name: "Sofía" },
					{
						participantType: "guest",
						participantId: "ana1",
						name: "Ana",
						imageUrl: null,
					},
				],
			})),
		},
		transfers: {
			previewCreate: write("transfer.preview", () => ({
				changes: [],
				unchanged: [],
				unavailable: [],
			})),
			create: write("transfer.create", () => ({ undo: "undo-transfer" })),
			undo: write("transfer.undo"),
		},
		expenses: {
			list: async () => page([{ amount: { minor: 100, currency: "USD" } }]),
			create: write("expenses.create", () => ({ undo: "undo-expense" })),
			get: async () => ({
				id: "e1",
				kind: "expense",
				title: "Lunch",
				amount: { minor: 1_000_000, currency: "ARS" },
				rateType: null,
				date: "2026-10-20",
				categoryId: "cafe",
				location: "Tortoni",
				description: null,
				amortizeOver: null,
				excludeFromAnalytics: false,
			}),
			previewUpdate: write("expense.previewUpdate", () => ({
				changes: [],
				unchanged: [],
				unavailable: [],
			})),
			update: write("expense.update", () => ({
				expense: {},
				undo: "undo-edit",
			})),
			previewDelete: write("expense.previewDelete", () => ({
				changes: [],
				unchanged: [],
				unavailable: [],
			})),
			delete: write("expense.delete", () => ({
				id: "e1",
				undo: "undo-delete",
			})),
			undo: write("expense.undo"),
		},
		"shared-expenses": {
			// The server splits it; the composer shows the shares it names.
			previewCreate: write("shared.preview", () => ({
				changes: [],
				unchanged: [],
				unavailable: [],
				detail: {
					kind: "sharedExpense.create",
					shares: [
						{
							type: "user",
							id: "lucia1",
							name: "Lucía",
							you: false,
							before: null,
							after: money(625_000),
						},
						{
							type: "user",
							id: "me1",
							name: "Sofía",
							you: true,
							before: null,
							after: money(625_000),
						},
					],
				},
			})),
			create: write("shared.create", () => ({ undo: "undo-shared" })),
			previewUpdate: write("shared.previewUpdate", () => ({
				changes: [],
				unchanged: [],
				unavailable: [],
			})),
			update: write("shared.update", () => ({ undo: "undo-shared-edit" })),
			previewDelete: write("shared.previewDelete", (input) => {
				if (
					sharedDeleteWarning &&
					!(input as { confirmUnsettled?: boolean }).confirmUnsettled
				) {
					throw Object.assign(new Error(sharedDeleteWarning), { status: 409 });
				}
				return { changes: [], unchanged: [], unavailable: [] };
			}),
			delete: write("shared.delete", () => ({
				id: "s1",
				undo: "undo-shared-delete",
			})),
			get: async () => ({
				id: "s1",
				title: "Dinner",
				amount: { minor: 1_000_000, currency: "ARS" },
				date: "2026-10-21",
				notes: "birthday",
				splitMode: "EQUAL",
				project: null,
				category: { id: "cafe", name: "Cafe", color: "x" },
				locked: false,
				paidBy: { type: "user", id: "me1", name: "Sofía", imageUrl: null },
				splits: [
					{
						type: "user",
						id: "me1",
						name: "Sofía",
						imageUrl: null,
						share: { minor: 500_000, currency: "ARS" },
						percentage: null,
						units: null,
						verification: "ACCEPTED",
					},
					{
						type: "user",
						id: "lucia1",
						name: "Lucía",
						imageUrl: null,
						share: { minor: 500_000, currency: "ARS" },
						percentage: null,
						units: null,
						verification: "PENDING",
					},
				],
				canEdit: true,
			}),
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

async function open(
	mode: EntryMode,
	onDone: () => void = () => {},
	editId?: string,
	editShared = false,
) {
	let tree!: Tree;
	await act(async () => {
		tree = create(
			<EntryComposer
				editId={editId}
				editShared={editShared}
				initialMode={mode}
				onDone={onDone}
			/>,
		);
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

/** Presses the button whose spoken label starts with `prefix` (a row that adds its detail to its name). */
function pressStarting(tree: Tree, prefix: string) {
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

/** The words under a node, joined. */
function textOf(node: TestNode | string): string {
	if (typeof node === "string") return node;
	return node.children.map(textOf).join("");
}

/** Presses the button whose words are `text` (a text action has no label of its own). */
function pressWords(tree: Tree, text: string) {
	const hit = tree.root.findAll(
		(n) => typeof n.props.onPress === "function" && textOf(n) === text,
	)[0];
	if (!hit) throw new Error(`nothing to press: ${text}`);
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
	mockNet.isInternetReachable = true;
	await local.outbox.clear();
	jest.useFakeTimers();
	mockToast.show.mockClear();
});
afterEach(() => jest.useRealTimers());

// The jest window has a font scale of 2; the composer's keypad shows at the default size.
function fontScale(scale: number) {
	const { Dimensions } = require("react-native");
	return jest
		.spyOn(Dimensions, "get")
		.mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: scale });
}
beforeEach(() => {
	fontScale(1);
});
afterEach(() => jest.restoreAllMocks());

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
		expect(words(tree)).toContain("Each pays");
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
		// Add stays off until there is an amount.
		const add = find(tree, (p) => p.accessibilityLabel === "Add expense")[0];
		expect(add?.props.disabled).toBe(true);
		press(tree, "9");
		await settle();
		press(tree, "Add expense");
		await flush();
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
		// The quick step says it in one line; More has the whole block.
		expect(words(tree)).toContain("Not planned yet +ARS 340,000");
		press(tree, "More");
		// The plan's envelope names are read when it first shows.
		await flush();
		expect(words(tree)).toContain("What this changes");
		expect(words(tree)).toContain("Not planned yet");
		expect(words(tree)).toContain("+ARS 340,000");
		expect(words(tree)).toContain("to ARS 340,000");
		expect(words(tree)).toContain(
			"Nothing else changes: your spending stays as it is.",
		);
		// Then the plan: the envelope it fills and what stays Not planned yet.
		expect(words(tree)).toContain("Then your plan assigns");
		expect(words(tree)).toContain("Rent");
		expect(words(tree)).toContain("+ARS 250,000");
		expect(words(tree)).toContain("Not planned yet stays");
		expect(words(tree)).toContain("ARS 90,000");

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

describe("Add expense into a project", () => {
	it("hides projects a viewer can not add to, takes in the people and writes projectId", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		// The Project panel lists the projects you can add to, not the ones you only view.
		expect(
			find(
				tree,
				(p) =>
					typeof p.accessibilityLabel === "string" &&
					p.accessibilityLabel.startsWith("Club"),
			),
		).toHaveLength(0);
		pressStarting(tree, "Trip");
		await flush();
		// The project's people on the day come in; you are the payer.
		expect(words(tree)).toContain("Ana");
		press(tree, "Cafe");
		for (const key of ["9", "0", "0"]) press(tree, key);
		await settle();
		press(tree, "Add expense");
		await flush();
		const sent = calls.find((c) => c.route === "shared.create");
		expect(sent?.input).toMatchObject({
			projectId: "trip",
			paidBy: { type: "user", id: "me1" },
			splitWith: [
				{ type: "user", id: "me1" },
				{ type: "guest", id: "ana1" },
			],
		});
		act(() => tree.unmount());
	});
});

describe("Add transfer", () => {
	it("previews and writes a move between two accounts, and undoes it", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("transfer");
		for (const key of ["1", "5", "0", "0"]) press(tree, key);
		await settle();
		expect(calls.some((c) => c.route === "transfer.preview")).toBe(true);
		press(tree, "Add transfer");
		await flush();
		expect(calls.find((c) => c.route === "transfer.create")?.input).toEqual({
			id: "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11",
			fromAccountId: "cash",
			toAccountId: "bank",
			fromCurrency: "ARS",
			toCurrency: "ARS",
			fromAmount: "1500.00",
			date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
		});
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		expect(toast.message).toBe("Added Cash > Bank");
		await act(async () => toast.undo.onUndo());
		expect(calls.some((c) => c.route === "transfer.undo")).toBe(true);
		act(() => tree.unmount());
	});
});

describe("Edit expense", () => {
	it("starts from the saved values, previews the update, saves and undoes", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "e1");
		expect(words(tree)).toContain("10,000");
		type(tree, "Title", "Team lunch");
		await settle();
		const preview = calls.find((c) => c.route === "expense.previewUpdate");
		expect(preview?.input).toMatchObject({ id: "e1", title: "Team lunch" });
		press(tree, "Save expense");
		await flush();
		expect(calls.find((c) => c.route === "expense.update")?.input).toEqual({
			id: "e1",
			title: "Team lunch",
			amount: "10000.00",
			currency: "ARS",
			date: "2026-10-20",
			categoryId: "cafe",
			excludeFromAnalytics: false,
			location: "Tortoni",
		});
		expect(done).toHaveBeenCalledTimes(1);
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		expect(toast.message).toBe("Saved Team lunch");
		await act(async () => toast.undo.onUndo());
		expect(calls.find((c) => c.route === "expense.undo")?.input).toEqual({
			token: "undo-edit",
		});
		// An edit never goes through the outbox.
		expect(await local.outbox.all()).toHaveLength(0);
		act(() => tree.unmount());
	});

	it("keeps the sheet open and says so when the phone is offline", async () => {
		const { api } = fakeApi();
		(api as unknown as { expenses: { update: unknown } }).expenses.update =
			async () => {
				throw new TypeError("Network request failed");
			};
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "e1");
		await settle();
		press(tree, "Save expense");
		await flush();
		expect(done).not.toHaveBeenCalled();
		expect(mockToast.show).toHaveBeenLastCalledWith({
			message: "You're offline. Editing needs a connection.",
		});
		act(() => tree.unmount());
	});
});

describe("Details", () => {
	it("shows note, place, spread and exclude with no toggle, and sends them on a personal expense", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Cafe");
		for (const key of ["9", "0", "0"]) press(tree, key);
		// More holds each option as a row; turning one on opens its control in place.
		expect(words(tree)).toContain("Spread over months");
		expect(words(tree)).toContain("Exclude from spending");
		press(tree, "Note, Add");
		type(tree, "Note", "with the team");
		press(tree, "Location, Add");
		type(tree, "Location", "Cafe Tortoni");
		press(tree, "Spread over months, Add");
		press(tree, "6 months");
		await settle();
		press(tree, "Add expense");
		await flush();
		expect(
			calls.find((c) => c.route === "expenses.create")?.input,
		).toMatchObject({
			description: "with the team",
			location: "Cafe Tortoni",
			amortizeOver: 6,
			excludeFromAnalytics: false,
		});
		act(() => tree.unmount());
	});

	it("keeps place and spread out of a split, and sends its note as notes", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Lucía Fernández");
		press(tree, "Cafe");
		for (const key of ["9", "0", "0"]) press(tree, key);
		expect(
			find(
				tree,
				(p) =>
					typeof p.accessibilityLabel === "string" &&
					(p.accessibilityLabel.startsWith("Location") ||
						p.accessibilityLabel.startsWith("Spread")),
			),
		).toHaveLength(0);
		press(tree, "Note, Add");
		type(tree, "Note", "birthday");
		await settle();
		press(tree, "Add expense");
		await flush();
		const sent = calls.find((c) => c.route === "shared.create")?.input;
		expect(sent).toMatchObject({ notes: "birthday" });
		expect(sent).not.toHaveProperty("location");
		act(() => tree.unmount());
	});
});

describe("An expense in another currency", () => {
	// Dollars spent by someone whose home is pesos.
	beforeEach(() => {
		mockMe.defaultCurrency = "USD";
	});
	afterEach(() => {
		mockMe.defaultCurrency = "ARS";
	});

	async function twelveDollars() {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Cafe");
		for (const key of ["1", "2"]) press(tree, key);
		await settle();
		return { tree, calls };
	}

	it("shows the amount at home at the default type, as the server books it", async () => {
		const { tree, calls } = await twelveDollars();
		expect(calls.find((c) => c.route === "entry.rateOptions")?.input).toEqual({
			currency: "USD",
			date: expect.any(String),
			amount: "12.00",
		});
		// The original stays the big number; home is the server's 12 x 1,465.
		expect(words(tree)).toContain("ARS 17,580");
		expect(
			find(tree, (p) => p.label === "Blue rate" && p.variant === "text"),
		).not.toHaveLength(0);
		act(() => tree.unmount());
	});

	it("saves the picked rate type", async () => {
		const { tree, calls } = await twelveDollars();
		press(tree, "Exchange rate, Blue");
		press(tree, "pick Official");
		await settle();
		expect(words(tree)).toContain("ARS 12,600");
		press(tree, "Add expense");
		await flush();
		expect(
			calls.find((c) => c.route === "expenses.create")?.input,
		).toMatchObject({ currency: "USD", amount: "12.00", rateType: "official" });
		act(() => tree.unmount());
	});

	it("saves a typed rate, and waits while it does not read as one", async () => {
		const { tree, calls } = await twelveDollars();
		press(tree, "Exchange rate, Blue");
		press(tree, "pick Custom rate");
		press(tree, "Add expense");
		await flush();
		expect(calls.some((c) => c.route === "expenses.create")).toBe(false);
		expect(words(tree)).toContain("Enter a rate above zero");
		type(tree, "Custom rate, 1 USD in ARS", "1200");
		await settle();
		expect(words(tree)).toContain("ARS 14,400");
		press(tree, "Add expense");
		await flush();
		const sent = calls.find((c) => c.route === "expenses.create")?.input;
		expect(sent).toMatchObject({ customRate: "1200" });
		expect(sent).not.toHaveProperty("rateType");
		act(() => tree.unmount());
	});

	it("states the default type on a split instead of offering a pick", async () => {
		const { tree } = await twelveDollars();
		press(tree, "Lucía Fernández");
		await settle();
		expect(words(tree)).toContain("Your default rate: Blue");
		expect(
			find(tree, (p) => p.accessibilityLabel === "Exchange rate, Blue"),
		).toHaveLength(0);
		act(() => tree.unmount());
	});
});

describe("Edit a split expense", () => {
	it("previews, saves the saved split back with the new title, and undoes", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "s1", true);
		type(tree, "Title", "Team dinner");
		await settle();
		expect(
			calls.find((c) => c.route === "shared.previewUpdate")?.input,
		).toMatchObject({
			id: "s1",
			description: "Team dinner",
		});
		press(tree, "Save expense");
		await flush();
		expect(calls.find((c) => c.route === "shared.update")?.input).toEqual({
			id: "s1",
			description: "Team dinner",
			amount: "10000.00",
			currency: "ARS",
			date: "2026-10-21",
			categoryId: "cafe",
			paidBy: { type: "user", id: "me1" },
			splitMode: "EQUAL",
			notes: "birthday",
		});
		expect(done).toHaveBeenCalledTimes(1);
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		await act(async () => toast.undo.onUndo());
		expect(calls.find((c) => c.route === "shared.undo")?.input).toEqual({
			token: "undo-shared-edit",
		});
		act(() => tree.unmount());
	});

	it("says whose share moves, from the dry run", async () => {
		const { api } = fakeApi();
		const shared = (
			api as unknown as Record<string, { previewUpdate: unknown }>
		)["shared-expenses"] as { previewUpdate: unknown };
		shared.previewUpdate = async () => ({
			changes: [],
			unchanged: [],
			unavailable: [],
			detail: {
				kind: "sharedExpense.update",
				shares: [
					{
						type: "user",
						id: "me1",
						name: "Sofía",
						you: true,
						before: { minor: 500_000, currency: "ARS" },
						after: { minor: 600_000, currency: "ARS" },
					},
					{
						type: "user",
						id: "lucia1",
						name: "Lucía",
						you: false,
						before: { minor: 500_000, currency: "ARS" },
						after: { minor: 600_000, currency: "ARS" },
					},
					{
						type: "guest",
						id: "g1",
						name: "Ana",
						you: false,
						before: { minor: 100, currency: "ARS" },
						after: { minor: 100, currency: "ARS" },
					},
				],
			},
		});
		mockSession.api = api;
		const tree = await open("expense", () => {}, "s1", true);
		type(tree, "Title", "Team dinner");
		await settle();
		press(tree, "What this changes, Show");
		const text = words(tree);
		expect(text).toContain("What each person owes");
		expect(text).toContain("You");
		expect(text).toContain("Lucía");
		// A share that stays the same is not listed.
		expect(text).not.toContain("Ana");
		expect(text).toContain("They're told about the change.");
		act(() => tree.unmount());
	});

	it("shows no saved share beside a changed amount until the dry run answers", async () => {
		const { api } = fakeApi();
		const shared = (
			api as unknown as Record<string, { previewUpdate: unknown }>
		)["shared-expenses"] as { previewUpdate: unknown };
		let answer!: (diff: object) => void;
		shared.previewUpdate = () =>
			new Promise((resolve) => {
				answer = resolve;
			});
		mockSession.api = api;
		const tree = await open("expense", () => {}, "s1", true);
		// Nothing changed yet: the saved shares are right.
		expect(words(tree)).toContain("5,000");
		type(tree, "Title", "Team dinner");
		await act(async () => {
			jest.advanceTimersByTime(400);
		});
		// Changed, no answer: the saved shares are stale and are not shown.
		expect(words(tree)).not.toContain("5,000");
		await act(async () => {
			answer({
				changes: [],
				unchanged: [],
				unavailable: [],
				detail: {
					kind: "sharedExpense.update",
					shares: [
						{
							type: "user",
							id: "me1",
							name: "Sofía",
							you: true,
							before: { minor: 500_000, currency: "ARS" },
							after: { minor: 600_000, currency: "ARS" },
						},
					],
				},
			});
		});
		await flush();
		expect(words(tree)).toContain("6,000");
		act(() => tree.unmount());
	});

	it("keeps the project when the date changes, reading no people", async () => {
		const { api, calls } = fakeApi();
		const shared = (api as unknown as Record<string, { get: unknown }>)[
			"shared-expenses"
		] as { get: () => Promise<Record<string, unknown>> };
		const get = shared.get;
		shared.get = async () => ({
			...(await (get as () => Promise<object>)()),
			project: { id: "trip", name: "Trip" },
		});
		(api as unknown as { projects: { members: unknown } }).projects.members =
			async () => {
				throw new TypeError("Network request failed");
			};
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "s1", true);
		pressStarting(tree, "Yesterday");
		await settle();
		press(tree, "Save expense");
		await flush();
		expect(calls.some((c) => c.route === "projects.members")).toBe(false);
		expect(calls.find((c) => c.route === "shared.update")?.input).toMatchObject(
			{ id: "s1", projectId: "trip" },
		);
		expect(done).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("keeps someone else's category, shown and sent back", async () => {
		const { api, calls } = fakeApi();
		const shared = (api as unknown as Record<string, { get: unknown }>)[
			"shared-expenses"
		] as { get: () => Promise<Record<string, unknown>> };
		const get = shared.get;
		shared.get = async () => ({
			...(await (get as () => Promise<object>)()),
			category: { id: "theirs", name: "Gifts", color: "x" },
		});
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "s1", true);
		expect(words(tree)).toContain("Gifts");
		type(tree, "Title", "Team dinner");
		await settle();
		press(tree, "Save expense");
		await flush();
		expect(calls.find((c) => c.route === "shared.update")?.input).toMatchObject(
			{ description: "Team dinner", categoryId: "theirs" },
		);
		expect(done).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("says it can't be edited when the server says so", async () => {
		const { api } = fakeApi();
		const shared = (api as unknown as Record<string, { get: unknown }>)[
			"shared-expenses"
		] as { get: () => Promise<Record<string, unknown>> };
		const get = shared.get;
		shared.get = async () => ({
			...(await (get as () => Promise<object>)()),
			canEdit: false,
		});
		mockSession.api = api;
		const tree = await open("expense", () => {}, "s1", true);
		expect(words(tree)).toContain("This expense can't be edited");
		act(() => tree.unmount());
	});
});

describe("Edit needs its dry run", () => {
	it("does not save while the preview could not be reached", async () => {
		const { api, calls } = fakeApi();
		(
			api as unknown as { expenses: { previewUpdate: unknown } }
		).expenses.previewUpdate = async () => {
			throw new TypeError("Network request failed");
		};
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "e1");
		await settle();
		press(tree, "Save expense");
		await flush();
		expect(calls.some((c) => c.route === "expense.update")).toBe(false);
		expect(done).not.toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("asks again on Try again, then saves", async () => {
		const { api, calls } = fakeApi();
		const expenses = (
			api as unknown as { expenses: { previewUpdate: unknown } }
		).expenses;
		const ok = expenses.previewUpdate;
		expenses.previewUpdate = async () => {
			throw new TypeError("Network request failed");
		};
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "e1");
		await settle();
		expect(words(tree)).toContain("You're offline.");
		expenses.previewUpdate = ok;
		// Try again is in the whole block, in More.
		press(tree, "What this changes, Show");
		const tryAgain = tree.root.findAll(
			(n) =>
				typeof n.props.onPress === "function" &&
				n.props.accessibilityRole === "button" &&
				n.findAll((c) => c.children.includes("Try again")).length > 0,
		)[0];
		if (!tryAgain) throw new Error("no Try again");
		act(() => {
			(tryAgain.props.onPress as () => void)();
		});
		await settle();
		expect(words(tree)).not.toContain("You're offline.");
		press(tree, "Save expense");
		await flush();
		expect(calls.some((c) => c.route === "expense.update")).toBe(true);
		expect(done).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("asks again by itself when the network returns", async () => {
		const { api, calls } = fakeApi();
		const expenses = (
			api as unknown as { expenses: { previewUpdate: unknown } }
		).expenses;
		const ok = expenses.previewUpdate;
		expenses.previewUpdate = async () => {
			throw new TypeError("Network request failed");
		};
		mockSession.api = api;
		mockNet.isInternetReachable = false;
		const tree = await open("expense", () => {}, "e1");
		await settle();
		expect(words(tree)).toContain("You're offline.");
		expenses.previewUpdate = ok;
		mockNet.isInternetReachable = true;
		// A render with the network back, as expo-network would cause.
		type(tree, "Title", "Lunch");
		await settle();
		expect(words(tree)).not.toContain("You're offline.");
		expect(calls.some((c) => c.route === "expense.previewUpdate")).toBe(true);
		act(() => tree.unmount());
	});
});

describe("Picking projects quickly", () => {
	it("keeps the people of the latest pick when an earlier answer arrives late", async () => {
		const { api } = fakeApi();
		let finishTrip: (value: unknown) => void = () => {};
		const members = (api as unknown as { projects: { members: unknown } })
			.projects;
		members.members = (input: { id: string }) =>
			input.id === "trip"
				? new Promise((resolve) => {
						finishTrip = resolve;
					})
				: Promise.resolve({ items: [] });
		mockSession.api = api;
		const tree = await open("expense");
		pressStarting(tree, "Trip");
		// The person changes their mind before the first answer comes.
		press(tree, "Personal, Only you");
		await flush();
		await act(async () => {
			finishTrip({
				items: [
					{
						participantType: "guest",
						participantId: "ana1",
						name: "Ana",
						imageUrl: null,
					},
				],
			});
		});
		await flush();
		expect(words(tree)).not.toContain("Ana");
		expect(words(tree)).toContain("Personal");
		act(() => tree.unmount());
	});
});

describe("Unsaved changes", () => {
	it("tells the host once something is typed, so a share asks before replacing it", async () => {
		const { api } = fakeApi();
		mockSession.api = api;
		const dirty = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<EntryComposer
					initialMode="expense"
					onDirtyChange={dirty}
					onDone={() => {}}
				/>,
			);
		});
		await flush();
		expect(dirty).toHaveBeenLastCalledWith(false);
		type(tree, "Title", "Coffee");
		await flush();
		expect(dirty).toHaveBeenLastCalledWith(true);
		act(() => tree.unmount());
	});
});

describe("The amount card", () => {
	it("adds up what the operators build, and sends the sum", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Cafe");
		press(tree, "1");
		press(tree, "2");
		press(tree, "Plus, hold for times");
		press(tree, "3");
		expect(words(tree)).toContain("12+3");
		await settle();
		press(tree, "Add expense");
		await flush();
		expect(
			calls.find((c) => c.route === "expenses.create")?.input,
		).toMatchObject({ amount: "15.00" });
		act(() => tree.unmount());
	});

	it("takes what arrived in a second row of the card, and leaves it empty for the reference rate", async () => {
		const { api, calls } = fakeApi();
		(
			api as unknown as {
				entry: { catalog: () => Promise<unknown> };
			}
		).entry.catalog = async () => ({
			places: [
				{ id: "cash", name: "Cash", type: "CASH", currency: "ARS" },
				{ id: "usd", name: "Dollars", type: "CASH", currency: "USD" },
			],
		});
		mockSession.api = api;
		const tree = await open("transfer");
		for (const key of ["1", "0", "0", "0"]) press(tree, key);
		// The second row is the card's, not a text field: the keypad types into it.
		press(tree, "Received in USD, optional");
		press(tree, "9");
		await settle();
		press(tree, "Add transfer");
		await flush();
		expect(
			calls.find((c) => c.route === "transfer.create")?.input,
		).toMatchObject({
			fromAmount: "1000.00",
			toAmount: "9.00",
			toCurrency: "USD",
		});
		act(() => tree.unmount());
	});
});

describe("Edit: undo changes and delete", () => {
	it("puts every field back from the actions menu", async () => {
		const { api } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense", () => {}, "e1");
		// Nothing changed yet, so there is nothing to undo.
		expect(
			find(tree, (p) => p.accessibilityLabel === "Undo changes"),
		).toHaveLength(0);
		type(tree, "Title", "Team lunch");
		await flush();
		press(tree, "Undo changes");
		await flush();
		const field = find(
			tree,
			(p) => p.accessibilityLabel === "Title" && "value" in p,
		)[0];
		expect(field?.props.value).toBe("Lunch");
		act(() => tree.unmount());
	});

	it("deletes after the dry run, and Undo takes it back", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "e1");
		press(tree, "Delete");
		await flush();
		expect(
			calls.find((c) => c.route === "expense.previewDelete")?.input,
		).toEqual({ id: "e1" });
		const confirm = find(
			tree,
			(p) => p.label === "Delete expense" && typeof p.onPress === "function",
		)[0];
		if (!confirm) throw new Error("no Delete button");
		await act(async () => {
			(confirm.props.onPress as () => void)();
		});
		await flush();
		expect(calls.find((c) => c.route === "expense.delete")?.input).toEqual({
			id: "e1",
		});
		expect(done).toHaveBeenCalledTimes(1);
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		expect(toast.message).toBe("Deleted Lunch");
		await act(async () => toast.undo.onUndo());
		expect(calls.find((c) => c.route === "expense.undo")?.input).toEqual({
			token: "undo-delete",
		});
		act(() => tree.unmount());
	});
	it("deletes a split after the dry run, and Undo brings back every share", async () => {
		sharedDeleteWarning = null;
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const done = jest.fn();
		const tree = await open("expense", done, "s1", true);
		press(tree, "Delete");
		await flush();
		expect(
			calls.find((c) => c.route === "shared.previewDelete")?.input,
		).toEqual({ id: "s1" });
		const confirm = find(
			tree,
			(p) => p.label === "Delete expense" && typeof p.onPress === "function",
		)[0];
		if (!confirm) throw new Error("no Delete button");
		await act(async () => {
			(confirm.props.onPress as () => void)();
		});
		await flush();
		// Nothing was warned about, so nothing was confirmed for the person.
		expect(calls.find((c) => c.route === "shared.delete")?.input).toEqual({
			id: "s1",
		});
		expect(done).toHaveBeenCalledTimes(1);
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		expect(toast.message).toBe("Deleted Dinner");
		await act(async () => toast.undo.onUndo());
		expect(calls.find((c) => c.route === "shared.undo")?.input).toEqual({
			token: "undo-shared-delete",
		});
		act(() => tree.unmount());
	});

	it("shows the server's warning for a split and deletes only when the button is pressed", async () => {
		sharedDeleteWarning =
			"This expense still has an unsettled balance between participants.";
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense", () => {}, "s1", true);
		press(tree, "Delete");
		await flush();
		// The warning is on the sheet, and the dry run is asked again as if confirmed.
		expect(
			calls
				.filter((c) => c.route === "shared.previewDelete")
				.map((c) => c.input),
		).toEqual([{ id: "s1" }, { id: "s1", confirmUnsettled: true }]);
		expect(
			find(tree, (p) =>
				String(p.children ?? "").startsWith("This expense still has"),
			).length,
		).toBeGreaterThan(0);
		expect(calls.some((c) => c.route === "shared.delete")).toBe(false);
		const anyway = find(
			tree,
			(p) => p.label === "Delete anyway" && typeof p.onPress === "function",
		)[0];
		if (!anyway) throw new Error("no Delete anyway button");
		await act(async () => {
			(anyway.props.onPress as () => void)();
		});
		await flush();
		expect(calls.find((c) => c.route === "shared.delete")?.input).toEqual({
			id: "s1",
			confirmUnsettled: true,
		});
		sharedDeleteWarning = null;
		act(() => tree.unmount());
	});
});

describe("Who paid and a custom split", () => {
	type Shared = { previewCreate: unknown; previewUpdate: unknown };
	const sharedOf = (api: RetrospendClient) =>
		(api as unknown as Record<string, Shared>)["shared-expenses"] as Shared;

	it("pays by someone else and splits by percent, saving only once the server accepts the parts", async () => {
		const { api, calls } = fakeApi();
		// The server checks the total: parts that do not make 100 are refused.
		sharedOf(api).previewCreate = async (input: {
			splitMode: string;
			splitWith: { sharePercentage?: string }[];
		}) => {
			calls.push({ route: "shared.preview", input });
			const sum = input.splitWith.reduce(
				(a, s) => a + Number(s.sharePercentage ?? 0),
				0,
			);
			if (input.splitMode === "PERCENTAGE" && sum !== 100) {
				throw Object.assign(new Error("parts"), {
					status: 400,
					code: "bad_request",
				});
			}
			return {
				changes: [],
				unchanged: [],
				unavailable: [],
				detail: {
					kind: "sharedExpense.create",
					shares: [
						{
							type: "user",
							id: "me1",
							you: true,
							name: "Sofía",
							before: null,
							after: money(3000),
						},
						{
							type: "user",
							id: "lucia1",
							you: false,
							name: "Lucía",
							before: null,
							after: money(7000),
						},
					],
				},
			};
		};
		mockSession.api = api;
		const tree = await open("expense");
		press(tree, "Cafe");
		press(tree, "Lucía Fernández");
		for (const key of ["1", "0", "0"]) press(tree, key);
		press(tree, "Paid by Lucía Fernández");
		press(tree, "Percent");
		// A part is typed on the keypad: tap the person's row, then the keys.
		press(tree, "You, Percent");
		for (const key of ["3", "0"]) press(tree, key);
		press(tree, "Lucía Fernández, Percent");
		for (const key of ["6", "0"]) press(tree, key);
		await settle();
		// 90 percent: the server refuses, so Save does not send and the line says why.
		expect(words(tree)).toContain("These parts don't add up");
		press(tree, "Add expense");
		await flush();
		expect(calls.some((c) => c.route === "shared.create")).toBe(false);

		pressStarting(tree, "Lucía Fernández, 60");
		press(tree, "Delete");
		press(tree, "Delete");
		for (const key of ["7", "0"]) press(tree, key);
		await settle();
		expect(words(tree)).toContain("Share ARS 70");
		press(tree, "Add expense");
		await flush();
		expect(calls.find((c) => c.route === "shared.create")?.input).toEqual({
			id: "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11",
			description: "Cafe",
			amount: "100.00",
			currency: "ARS",
			date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			categoryId: "cafe",
			paidBy: { type: "user", id: "lucia1" },
			splitMode: "PERCENTAGE",
			splitWith: [
				{ type: "user", id: "me1", sharePercentage: "30" },
				{ type: "user", id: "lucia1", sharePercentage: "70" },
			],
		});
		const toast = mockToast.show.mock.calls.at(-1)?.[0];
		expect(toast.undo.label).toBe("Undo");
		act(() => tree.unmount());
	});

	it("an edit that changes who paid sends the whole split", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense", () => {}, "s1", true);
		press(tree, "Paid by Lucía Fernández");
		await settle();
		expect(
			calls.filter((c) => c.route === "shared.previewUpdate").at(-1)?.input,
		).toMatchObject({
			paidBy: { type: "user", id: "lucia1" },
			splitMode: "EQUAL",
			splitWith: [
				{ type: "user", id: "me1" },
				{ type: "user", id: "lucia1" },
			],
		});
		press(tree, "Save expense");
		await flush();
		expect(calls.find((c) => c.route === "shared.update")?.input).toMatchObject(
			{
				paidBy: { type: "user", id: "lucia1" },
				splitWith: [
					{ type: "user", id: "me1" },
					{ type: "user", id: "lucia1" },
				],
			},
		);
		act(() => tree.unmount());
	});
});

describe("Add expense at the largest text size", () => {
	it("types the amount on the system decimal keyboard, with no keypad to cut off", async () => {
		fontScale(3);
		const { api } = fakeApi();
		mockSession.api = api;
		const tree = await open("expense");

		// The keypad is gone; the amount is a text input on the decimal pad.
		expect(find(tree, (p) => p.accessibilityLabel === "5")).toHaveLength(0);
		const amount = find(tree, (p) => p.keyboardType === "decimal-pad")[0];
		if (!amount) throw new Error("no amount input");
		act(() => {
			(amount.props.onChangeText as (text: string) => void)("12500");
		});
		await settle();
		const typed = find(tree, (p) => p.keyboardType === "decimal-pad")[0];
		expect(typed?.props.value).toBe("12,500");
		act(() => tree.unmount());
	});
});

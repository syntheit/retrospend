import type { RetrospendClient } from "@retrospend/api-client";
import {
	act,
	disabled,
	lastToast,
	mount,
	pressAsync,
	wait,
	world,
} from "../../../test/harness";
import { RecurringComposer } from "./RecurringComposer";

// Add a recurring expense with real presses: the dry run of the exact body
// comes first, Add stays off until it is in, the write carries the same body
// under one key, and the toast undoes it by deleting the new template.
// The frame's own layout is not under test: it hands back what the composer
// gave it as pressable stand-ins.
const mockFrame: {
	tabs: { key: string }[];
	summary: { key: string; text: string }[];
	panels: unknown[];
} = { tabs: [], summary: [], panels: [] };
jest.mock("@/features/entry/ComposerFrame", () => {
	const { Pressable, View } = require("react-native");
	return {
		SYSTEM_PAD_SCALE: 1.5,
		ComposerFrame: (props: {
			add: { onPress: () => void; label: string; off: boolean };
			title: unknown;
			amount: unknown;
			header: unknown;
			tabs: { key: string }[];
			summary: { key: string; text: string }[];
			panels: unknown[];
		}) => {
			mockFrame.tabs = props.tabs;
			mockFrame.summary = props.summary;
			mockFrame.panels = props.panels;
			return (
				<View>
					{props.header}
					{props.title}
					{props.amount}
					{props.panels}
					<Pressable
						accessibilityLabel={props.add.label}
						accessibilityState={{ disabled: props.add.off }}
						onPress={props.add.off ? undefined : props.add.onPress}
					/>
				</View>
			);
		},
	};
});
jest.mock("@/features/entry/AmountEntry", () => {
	const { Pressable } = require("react-native");
	return {
		AmountEntry: ({ onText }: { onText: (text: string) => void }) => (
			<Pressable
				accessibilityLabel="Type amount"
				onPress={() => onText("12.50")}
			/>
		),
	};
});
jest.mock("@/features/entry/SheetHead", () => ({ SheetHead: () => null }));
jest.mock("@/ui/TextField", () => {
	const { Pressable } = require("react-native");
	return {
		FieldLabel: () => null,
		TextField: ({
			label,
			onChangeText,
		}: {
			label: string;
			onChangeText: (text: string) => void;
		}) => (
			<Pressable
				accessibilityLabel={label}
				onPress={() => onChangeText("  Streamly ")}
			/>
		),
	};
});
const mockCategories: { ids: string[] } = { ids: [] };
jest.mock("@/features/entry/CategoryPanel", () => ({
	CategoryPanel: ({
		catalog,
	}: {
		catalog: { categories: { id: string }[] };
	}) => {
		mockCategories.ids = catalog.categories.map((c) => c.id);
		return null;
	},
}));
jest.mock("@/features/entry/hooks", () => ({
	useEntryCatalog: () => ({
		status: "ready",
		stale: false,
		catalog: {
			categories: [],
			currencies: ["USD", "ARS"],
			recentCurrencies: [],
		},
	}),
}));
jest.mock("@/features/entry/MorePanel", () => ({ OptionRow: () => null }));
jest.mock("@/ui/CurrencyPicker", () => ({ CurrencyPicker: () => null }));
jest.mock("@/ui/DateField", () => ({ DateField: () => null }));
jest.mock("@/ui/GlyphPill", () => ({ GlyphPill: () => null }));
jest.mock("@/ui/Picker", () => ({ WheelField: () => null }));
jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));
const mockAnchor = jest.fn();
jest.mock("@retrospend/domain/recurring-post/template", () => {
	const actual = jest.requireActual(
		"@retrospend/domain/recurring-post/template",
	);
	return {
		...actual,
		anchorOf: (day: string) => mockAnchor(day) ?? actual.anchorOf(day),
	};
});

beforeEach(() => {
	world.me = { ...world.me, homeCurrency: "USD", defaultCurrency: "USD" };
	mockWrites.mockReset().mockReturnValue(null);
	mockAnchor.mockReset();
});

const catalog = {
	categories: [
		{
			id: "c1",
			name: "Rent",
			kind: "expense",
			icon: null,
			tone: 1,
			excludeByDefault: false,
			uses: 1,
		},
		{
			id: "c2",
			name: "Salary",
			kind: "income",
			icon: null,
			tone: 2,
			excludeByDefault: false,
			uses: 1,
		},
	],
	people: [],
	currencies: ["USD", "ARS"],
	recentCurrencies: [],
	places: [],
	projects: [],
	hasBudget: null,
};

describe("Add a recurring expense", () => {
	it("previews the exact body, writes it under one key, and undoes by deleting", async () => {
		const calls: { route: string; input: unknown; key?: string }[] = [];
		world.api = {
			recurring: {
				previewCreate: async (input: unknown) => {
					calls.push({ route: "preview", input });
					return { changes: [], unchanged: [], unavailable: [] };
				},
				create: async (
					input: unknown,
					init?: { context?: { idempotencyKey?: string } },
				) => {
					calls.push({
						route: "write",
						input,
						key: init?.context?.idempotencyKey,
					});
					return { id: "tpl-new", title: "Streamly" };
				},
				delete: async (input: unknown) => {
					calls.push({ route: "delete", input });
					return { ok: true };
				},
			},
		} as unknown as RetrospendClient;
		const onDone = jest.fn();
		const onClose = jest.fn();
		const tree = await mount(
			<RecurringComposer
				catalog={catalog as never}
				onClose={onClose}
				onDone={onDone}
			/>,
		);
		// The tabs are Category, Repeats and Changes.
		expect(mockFrame.tabs.map((t) => t.key)).toEqual([
			"category",
			"repeats",
			"changes",
		]);
		// An expense template offers expense categories only.
		expect(mockCategories.ids).toEqual(["c1"]);
		// Nothing to preview until there is a name and an amount.
		expect(calls).toHaveLength(0);
		expect(disabled(tree, "Add")).toBe(true);
		await pressAsync(tree, "Name");
		await pressAsync(tree, "Type amount");
		await wait(400);
		const preview = calls.find((c) => c.route === "preview");
		expect(preview?.input).toMatchObject({
			name: "Streamly",
			amount: "12.50",
			currency: "USD",
			frequency: "MONTHLY",
			autoPay: false,
		});
		// The answers read as a line.
		expect(mockFrame.summary.map((p) => p.text)).toContain("Monthly");
		expect(disabled(tree, "Add")).toBe(false);

		await pressAsync(tree, "Add");
		const write = calls.find((c) => c.route === "write");
		expect(write?.input).toEqual(preview?.input);
		expect(write?.key).toBeTruthy();
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();

		const toast = lastToast();
		expect(toast.message).toBe("Streamly added");
		await act(async () => {
			await toast.undo?.onUndo();
		});
		expect(calls.find((c) => c.route === "delete")?.input).toEqual({
			id: "tpl-new",
		});
	});
});

describe("Add a recurring expense under the dev flag", () => {
	const dry = { changes: [], unchanged: [], unavailable: [] };
	function device(over: { create?: () => Promise<unknown> } = {}) {
		const recurring = {
			previewCreate: jest.fn(async (_body: unknown) => dry),
			create: jest.fn(
				async (input: { id: string }): Promise<unknown> =>
					over.create
						? over.create()
						: { id: input.id, updatedAt: "2026-11-02T10:00:00.000Z" },
			),
			delete: jest.fn(async () => ({ ok: true })),
		};
		const writes = {
			book: jest.fn(async () => ({
				bookedAt: 1,
				changes: [],
				changed: [],
				base: null,
			})),
			comparePreview: jest.fn(async () => undefined),
			refresh: jest.fn(async () => undefined),
			pullsBegun: () => 1,
		};
		world.api = { recurring } as unknown as RetrospendClient;
		mockWrites.mockReturnValue(writes);
		return { recurring, writes };
	}
	async function fill() {
		const tree = await mount(
			<RecurringComposer
				catalog={catalog as never}
				onClose={jest.fn()}
				onDone={jest.fn()}
			/>,
		);
		await pressAsync(tree, "Name");
		await pressAsync(tree, "Type amount");
		await wait(400);
		return tree;
	}

	it("shows the server's dry run, holds the device's against it, and queues the create under the write's key", async () => {
		const { recurring, writes } = device();
		const tree = await fill();
		expect(recurring.previewCreate).toHaveBeenCalledTimes(1);
		expect(writes.comparePreview).toHaveBeenCalledTimes(1);
		await pressAsync(tree, "Add");
		const [body, init] = recurring.create.mock.calls[0] as unknown as [
			Record<string, unknown>,
			{ context: { idempotencyKey: string } },
		];
		const id = init.context.idempotencyKey;
		expect(body).toMatchObject({ id, name: "Streamly", amount: "12.50" });
		expect(writes.book).toHaveBeenCalledWith({ kind: "templateCreate", body });
		const entries = await world.local.outbox.snapshot();
		expect(entries.acked.map((e) => e.clientId)).toEqual([id]);
		expect(lastToast().message).toBe("Streamly added");
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		expect(recurring.delete).toHaveBeenCalledWith({ id }, expect.anything());
	});

	it("waits on the phone when the dry run cannot reach the server: Add is on and the create is queued", async () => {
		const { recurring } = device({
			create: async () => {
				throw new Error("Network request failed");
			},
		});
		recurring.previewCreate.mockRejectedValue(
			new Error("Network request failed"),
		);
		const tree = await fill();
		expect(disabled(tree, "Add")).toBe(false);
		await pressAsync(tree, "Add");
		const [entry] = await world.local.outbox.all();
		expect(entry).toMatchObject({
			entity: "recurring",
			kind: "create",
			baseVersion: null,
			payload: { name: "Streamly" },
		});
		expect(entry?.targetId).toBe(entry?.clientId);
		expect(lastToast().message).toBe(
			"Saved Streamly on this phone. It syncs when you're online.",
		);
	});

	it("a server error on the dry run keeps Add off", async () => {
		const { recurring } = device();
		recurring.previewCreate.mockRejectedValue(
			Object.assign(new Error("boom"), { status: 503, code: "unavailable" }),
		);
		const tree = await fill();
		expect(disabled(tree, "Add")).toBe(true);
	});

	it("flag off: the plain preview and create, no engine call, nothing queued", async () => {
		const { recurring, writes } = device();
		mockWrites.mockReturnValue(null);
		const tree = await fill();
		await pressAsync(tree, "Add");
		expect(recurring.create).toHaveBeenCalledTimes(1);
		const [sent] = recurring.create.mock.calls[0] as unknown as [object];
		expect("id" in sent).toBe(false);
		expect(writes.book).not.toHaveBeenCalled();
		expect(writes.comparePreview).not.toHaveBeenCalled();
		expect(await world.local.outbox.snapshot()).toEqual({
			open: [],
			acked: [],
		});
	});

	it("takes the monthly anchor from the domain's one rule", async () => {
		mockAnchor.mockReturnValue(7);
		const { recurring } = device();
		await fill();
		expect(recurring.previewCreate.mock.calls[0]?.[0]).toMatchObject({
			anchorDay: 7,
		});
	});
});

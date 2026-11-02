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

beforeEach(() => {
	world.me = { ...world.me, homeCurrency: "USD", defaultCurrency: "USD" };
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

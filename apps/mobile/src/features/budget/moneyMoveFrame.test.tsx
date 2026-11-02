import type { RetrospendClient } from "@retrospend/api-client";
import {
	act,
	disabled,
	lastToast,
	mount,
	pressAsync,
	pressStarting,
	wait,
	world,
} from "../../../test/harness";
import { MoveForm } from "./MoveForm";
import type { BudgetEnvelope, BudgetMonth } from "./source";
import { WealthMoveSheet } from "./WealthMoveSheet";

// The two moves share one frame (MoneyMoveFrame): the amount, the places, the
// one-line dry run and the one button. Each is previewed first, written once
// with the previewed body under one key, and ends in an Undo toast.
jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
jest.mock(
	"@/ui/Segmented",
	() => require("../../../test/native").segmentedMock,
);
interface FrameProps {
	header: unknown;
	panels: unknown;
	add: { label: string; off: boolean; onPress: () => void };
	keypad: { onChange: (text: string) => void };
	summary: { text: string }[];
	tabs: { key: string }[];
}
const mockFrame = { props: {} as FrameProps };
jest.mock("@/features/entry/ComposerFrame", () => {
	const { Pressable } = require("react-native");
	return {
		SYSTEM_PAD_SCALE: 1.5,
		ComposerFrame: (props: FrameProps) => {
			mockFrame.props = props;
			return (
				<>
					{props.header}
					{props.panels}
					<Pressable
						accessibilityLabel={props.add.label}
						accessibilityState={{ disabled: props.add.off }}
						onPress={props.add.off ? undefined : props.add.onPress}
					/>
				</>
			);
		},
	};
});
jest.mock("@/features/entry/AmountEntry", () => ({ AmountEntry: () => null }));

const typeAmount = (text: string) =>
	act(() => {
		mockFrame.props.keypad.onChange(text);
	});

const ars = (minor: number) => ({ minor, currency: "ARS" });
const food = { id: "e-food", name: "Food", left: ars(1_000) };
const rent = { id: "e-rent", name: "Rent", left: ars(0) };
const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR", defaultEnvelopeId: "e-rent" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(10_000) },
	groups: [{ id: "g1", name: "Spending", envelopes: [food, rent] }],
} as unknown as BudgetMonth;
const noChanges = { changes: [], unchanged: [], unavailable: [] };
/** The dry run of a move that raises the Left of Food. */
const raisesFood = {
	...noChanges,
	detail: {
		result: {
			envelopes: [{ id: "e-food", before: ars(1_000), after: ars(3_500) }],
		},
	},
};

interface Call {
	route: string;
	input?: unknown;
	key?: string;
}

describe("Move money (envelope)", () => {
	it("assigns from the pool, previewed first and written once under the batch id", async () => {
		const calls: Call[] = [];
		const keyed = (init?: { context?: { idempotencyKey?: string } }) =>
			init?.context?.idempotencyKey;
		world.api = {
			budget: {
				previewAssign: async (input: unknown) => {
					calls.push({ route: "previewAssign", input });
					return raisesFood;
				},
				assign: async (
					input: unknown,
					init?: { context?: { idempotencyKey?: string } },
				) => {
					calls.push({ route: "assign", input, key: keyed(init) });
					return { undo: "tok-assign" };
				},
				undo: async (input: unknown) => {
					calls.push({ route: "undo", input });
					return {};
				},
			},
		} as unknown as RetrospendClient;
		const onClose = jest.fn();
		const onDone = jest.fn();
		const tree = await mount(
			<MoveForm
				data={data}
				envelope={food as unknown as BudgetEnvelope}
				month={202610}
				onClose={onClose}
				onDone={onDone}
			/>,
		);
		// Nothing to save until there is an amount and a dry run.
		expect(disabled(tree, "Move")).toBe(true);
		expect(mockFrame.props.summary[0]?.text).toBe("To assign → Food");
		typeAmount("25");
		await wait(400);
		const preview = calls.find((c) => c.route === "previewAssign");
		expect(preview?.input).toMatchObject({
			mode: "add",
			items: [{ envelopeId: "e-food", amount: "25.00" }],
		});
		await pressAsync(tree, "Move");
		const write = calls.find((c) => c.route === "assign");
		expect(write?.input).toEqual(preview?.input);
		expect(write?.key).toBe((write?.input as { batchId?: string })?.batchId);
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(lastToast().message).toMatch(
			/^Moved .*25.* from To assign to Food$/,
		);
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "tok-assign",
		});
	});
});

describe("Move to Wealth (shared frame)", () => {
	it("names the envelope and the account on one line and keeps Move off without an amount", async () => {
		world.api = {
			accounts: {
				list: async () => ({
					accounts: [
						{
							id: "a-save",
							name: "Savings",
							type: "CASH",
							currency: "ARS",
							balance: ars(100_000),
							inBudget: false,
							closedAt: null,
						},
					],
				}),
			},
			transfers: { previewCreate: async () => noChanges },
		} as unknown as RetrospendClient;
		const tree = await mount(
			<WealthMoveSheet
				data={data}
				direction="to"
				onClose={jest.fn()}
				onDone={jest.fn()}
				visible
			/>,
		);
		await wait(10);
		expect(disabled(tree, "Move")).toBe(true);
		expect(
			mockFrame.props.summary.map((s: { text: string }) => s.text),
		).toEqual(["To assign → Savings", "Not tracked"]);
		expect(mockFrame.props.tabs.map((t: { key: string }) => t.key)).toEqual([
			"from",
			"to",
			"account",
			"changes",
		]);
		pressStarting(tree, "Food,");
		expect(mockFrame.props.summary[0]?.text).toBe("Food → Savings");
	});
});

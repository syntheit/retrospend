import type { RetrospendClient } from "@retrospend/api-client";
import { createReadCache } from "@/data/cache";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import {
	disabled,
	press,
	type Tree,
	toast,
	undoFromToast,
	wait,
} from "./harness";
import type { BudgetMonth } from "./source";
import { WealthMoveSheet } from "./WealthMoveSheet";

// Move to Wealth and Move in under the dev flag and the server's
// wealthWrites: a move the device books whole is queued with its leg and fee
// ids and sent once; a move it cannot book (it crosses the budget line, the
// budget is not read) is written online exactly as without the flag, and so is
// Move in. With either switch off nothing is booked.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockSession: {
	api: unknown;
	local: unknown;
} = { api: undefined, local: undefined };
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: mockSession.api, local: mockSession.local }),
}));
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => mockWrites(),
	deviceFlagOn: () => mockWrites() !== null,
}));
jest.mock("@/data/ids", () => require("./harness").idsMock);
jest.mock("@/ui/Toast", () => require("./harness").toastMock);
jest.mock("@/ui/Button", () => require("./harness").buttonMock);
jest.mock("@/ui/Sheet", () => require("./harness").sheetMock);
jest.mock("@/ui/Segmented", () => require("./harness").segmentedMock);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
interface FrameProps {
	header: unknown;
	panels: unknown;
	add: { label: string; off: boolean; onPress: () => void };
	keypad: { onChange: (text: string) => void };
}
const mockFrame: { props: FrameProps } = { props: {} as FrameProps };
jest.mock("@/features/entry/ComposerFrame", () => {
	const { Pressable } = require("react-native");
	return {
		ComposerFrame: (props: FrameProps) => {
			mockFrame.props = props;
			return (
				<>
					{props.header as never}
					{props.panels as never}
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
jest.mock("use-intl", () => require("./harness").intlMock);

const ars = (minor: number) => ({ minor, currency: "ARS" });
const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR", defaultEnvelopeId: "e-else" },
	month: { key: 202609, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [
		{
			id: "g1",
			name: "Spending",
			envelopes: [
				{ id: "e-food", name: "Food", left: ars(1_000) },
				{ id: "e-else", name: "Everything else", left: ars(0) },
			],
		},
	],
} as unknown as BudgetMonth;

const account = (id: string, name: string, inBudget: boolean) => ({
	id,
	name,
	type: "CASH",
	currency: "ARS",
	balance: ars(100_000),
	value: ars(100_000),
	inBudget,
	isLiquid: true,
	rateType: null,
	closedAt: null,
	interestRate: null,
	minimumPayment: null,
	dueDay: null,
	updatedAt: "2026-10-01T00:00:00Z",
});
const dry = { changes: [], unchanged: [], unavailable: [] };

function setup({ wealthWrites = true }: { wealthWrites?: boolean } = {}) {
	const store = createMemoryStore();
	const local = {
		cache: createReadCache(store, "scope"),
		outbox: createOutbox(store, "scope"),
	};
	const transfers = {
		previewCreate: jest.fn(async (..._a: unknown[]) => dry),
		create: jest.fn(async (..._a: unknown[]) => ({
			transfer: {},
			undo: "tok-transfer",
		})),
		undo: jest.fn(async (..._a: unknown[]) => ({})),
	};
	const income = {
		previewMoveIn: jest.fn(async (..._a: unknown[]) => dry),
		moveIn: jest.fn(async (..._a: unknown[]) => ({ undo: "tok-income" })),
		undo: jest.fn(async (..._a: unknown[]) => ({})),
	};
	const accounts = {
		list: async () => ({
			accounts: [
				account("a-save", "Savings", false),
				account("a-cash", "Cash", true),
			],
		}),
	};
	const platform = {
		serverInfo: jest.fn(async (..._a: unknown[]) => ({
			features: { wealthWrites },
		})),
	};
	const writes = {
		book: jest.fn(
			async (
				..._a: unknown[]
			): Promise<{
				bookedAt: number;
				changes: never[];
				changed: never[];
				base: string | null;
			} | null> => ({ bookedAt: 1, changes: [], changed: [], base: null }),
		),
		comparePreview: jest.fn(async (..._a: unknown[]) => undefined),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
		overlayAccount: jest.fn(async () => null),
	};
	mockSession.api = {
		transfers,
		income,
		accounts,
		platform,
	} as unknown as RetrospendClient;
	mockSession.local = local;
	mockWrites.mockReturnValue(writes);
	return { transfers, income, platform, writes, outbox: local.outbox };
}

beforeEach(() => {
	// The client ids keep counting: a confirmed write's key is spent for the whole run.
	toast.show.mockClear();
	mockWrites.mockReset().mockReturnValue(null);
	forgetUndoTokens();
	forgetSent();
});

async function open(direction: "to" | "from" = "to") {
	let tree!: Tree;
	await act(async () => {
		tree = create(
			<WealthMoveSheet
				data={data}
				direction={direction}
				onClose={jest.fn()}
				onDone={jest.fn()}
				visible
			/>,
		);
	});
	await wait(50);
	return tree;
}

async function fill(tree: Tree) {
	press(tree, "Food,");
	typeAmount("50");
	await wait(400);
}

describe("Move money to Wealth under the dev flag", () => {
	it("queues a move the device books, with its leg and fee ids, and sends it once", async () => {
		const { transfers, writes } = setup();
		const tree = await open();
		await fill(tree);
		press(tree, "Move");
		await wait(100);
		expect(writes.book).toHaveBeenCalledTimes(1);
		const [op] = writes.book.mock.calls[0] as unknown as [
			{ kind: string; body: Record<string, unknown> },
		];
		expect(op.kind).toBe("transferCreate");
		expect(op.body).toMatchObject({
			toAccountId: "a-save",
			fromAmount: "50.00",
			envelopeId: "e-food",
			fromLegId: expect.stringMatching(/^00000000-0000-4000-8000-/),
			toLegId: expect.stringMatching(/^00000000-0000-4000-8000-/),
			feeExpenseId: expect.stringMatching(/^00000000-0000-4000-8000-/),
			feeLegId: expect.stringMatching(/^00000000-0000-4000-8000-/),
		});
		expect(transfers.create).toHaveBeenCalledTimes(1);
		const [sent, init] = transfers.create.mock.calls[0] as unknown as [
			Record<string, unknown>,
			{ context: { idempotencyKey: string } },
		];
		// The entry's id is the transfer's id and the key; the label kept for Sync issues is not sent.
		expect(sent.id).toBe(init.context.idempotencyKey);
		expect(sent).toMatchObject({
			fromLegId: op.body.fromLegId,
			feeLegId: op.body.feeLegId,
		});
		expect(sent).not.toHaveProperty("title");
		await undoFromToast();
		expect(transfers.undo).toHaveBeenCalledWith(
			{ token: "tok-transfer" },
			expect.anything(),
		);
	});

	it("a move the device cannot book (it crosses the budget line) is written online as before", async () => {
		const { transfers, writes, outbox } = setup();
		writes.book.mockResolvedValue(null);
		const tree = await open();
		await fill(tree);
		press(tree, "Move");
		await wait(100);
		expect(transfers.create).toHaveBeenCalledTimes(1);
		const [sent, init] = transfers.create.mock.calls[0] as unknown as [
			Record<string, unknown>,
			{ context: { idempotencyKey: string } },
		];
		// Exactly the body of the dry run: no leg ids, the same key.
		expect(sent).not.toHaveProperty("fromLegId");
		expect(init.context.idempotencyKey).toBe(sent.id);
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		await undoFromToast();
		expect(transfers.undo).toHaveBeenCalledWith(
			{ token: "tok-transfer" },
			expect.anything(),
		);
	});

	it("offline Save stays off, as without the flag", async () => {
		const { transfers } = setup();
		transfers.previewCreate.mockRejectedValue(
			new Error("Network request failed"),
		);
		const tree = await open();
		await fill(tree);
		expect(disabled(tree, "Move")).toBe(true);
	});

	it("the server's switch off: the plain transfer, nothing booked", async () => {
		const { transfers, writes } = setup({ wealthWrites: false });
		const tree = await open();
		await fill(tree);
		press(tree, "Move");
		await wait(100);
		expect(transfers.create).toHaveBeenCalledTimes(1);
		expect(writes.book).not.toHaveBeenCalled();
		expect(writes.comparePreview).not.toHaveBeenCalled();
	});

	it("the dev flag off: the plain transfer, nothing booked, no question to the server", async () => {
		const { transfers, platform, writes } = setup();
		mockWrites.mockReturnValue(null);
		const tree = await open();
		await fill(tree);
		press(tree, "Move");
		await wait(100);
		expect(transfers.create).toHaveBeenCalledTimes(1);
		expect(writes.book).not.toHaveBeenCalled();
		expect(platform.serverInfo).not.toHaveBeenCalled();
	});
});

describe("Move in under the dev flag", () => {
	it("stays online: nothing is booked or queued", async () => {
		const { income, writes, outbox } = setup();
		const tree = await open("from");
		press(tree, "No, just count it");
		typeAmount("75");
		await wait(400);
		press(tree, "Move in");
		await wait(100);
		expect(income.moveIn).toHaveBeenCalledTimes(1);
		expect(writes.book).not.toHaveBeenCalled();
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		await undoFromToast();
		expect(income.undo).toHaveBeenCalledWith(
			{ token: "tok-income" },
			expect.anything(),
		);
	});
});

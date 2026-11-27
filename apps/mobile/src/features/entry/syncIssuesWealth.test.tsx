import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox, type Outbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { flushEntries } from "./queue";
import { SyncIssues } from "./SyncIssues";
import { apiTransport, forgetNotFound, forgetUndoTokens } from "./send";
import { forgetSent } from "./sentRetain";

// What Couldn't sync shows for a person's queued account and transfer writes:
// the real sender classifies the server's answer, the real outbox parks it,
// the real list reads it back. A write that met another device's change reads
// "Changed on another device", with Try again (a statement is saved again over
// the pulled account, after a dry run) and Discard; a whole-account edit is
// Discard only; a taken id shows the server's refusal line and is not resent.
// Words are the catalog keys (use-intl is the identity here).

const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}
interface Tree {
	root: TestNode;
	unmount(): void;
}

const mockSession: { api: unknown; local: { outbox: Outbox } | null } = {
	api: undefined,
	local: null,
};
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: mockSession.api, local: mockSession.local }),
}));
const mockStored = jest.fn();
const mockBook = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => ({
		storedAccount: mockStored,
		absentSince: async () => false,
		book: mockBook,
		refresh: async () => undefined,
		pullsBegun: () => 1,
	}),
}));
let mockNextId = 0;
jest.mock("@/data/ids", () => ({ newClientId: () => `new-${++mockNextId}` }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
const mockShowAlert = jest.fn();
jest.mock("@/ui/alert", () => ({
	showAlert: (...args: unknown[]) => mockShowAlert(...args),
}));
jest.mock("./changeWords", () => ({
	useChangeWords: () => ({
		money: (m: { minor: number }) => String(m.minor),
		marked: (t: string) => t,
	}),
}));
jest.mock("@/features/write/useFigureLabel", () => ({
	useFigureLabel: () => (id: string) => ({ name: id, inline: id }),
}));
jest.mock("@/lib/money", () => ({
	useFormatMoney: () => ({
		format: (m: { minor: number; currency: string }) =>
			`${m.currency} ${m.minor}`,
	}),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

const ID = "acct-galicia";
const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });
const dry = { changes: [], unchanged: [], unavailable: [] };

function setup() {
	const accounts = {
		updateBalance: jest.fn(async (_i: unknown, _o: unknown) => ({
			undo: "tok",
			result: { version: 8 },
		})),
		close: jest.fn(async (_i: unknown, _o: unknown) => ({
			undo: "tok",
			result: { version: 8 },
		})),
		update: jest.fn(async (_i: unknown, _o: unknown) => ({
			undo: "tok",
			result: { version: 8, legId: null, rateTypeId: null },
		})),
		create: jest.fn(async (_i: unknown, _o: unknown) => ({
			undo: "tok",
			result: { version: 0 },
		})),
		previewUpdateBalance: jest.fn(async (_i: unknown, _o: unknown) => dry),
		previewClose: jest.fn(async (_i: unknown, _o: unknown) => dry),
	};
	const transfers = {
		create: jest.fn(async (_i: unknown, _o: unknown) => ({ undo: "tok" })),
	};
	const api = { accounts, transfers } as never as RetrospendClient;
	const outbox = createOutbox(createMemoryStore(), "scope");
	mockSession.api = api;
	mockSession.local = { outbox };
	return { api, accounts, transfers, outbox };
}

async function render() {
	let tree!: Tree;
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	return tree;
}

const said = (tree: Tree) =>
	tree.root
		.findAll((n) => typeof n.props.children === "string")
		.map((n) => n.props.children as string);
const buttons = (tree: Tree) => [
	...new Set(
		tree.root
			.findAll(
				(n) =>
					n.props.accessibilityRole === "button" &&
					typeof n.props.accessibilityLabel === "string",
			)
			.map((b) => b.props.accessibilityLabel as string),
	),
];
const press = async (tree: Tree, label: string) => {
	const hit = tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.onPress === "function",
	)[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	await act(async () => {
		await (hit.props.onPress as () => Promise<void>)();
	});
};

beforeEach(() => {
	mockNextId = 0;
	mockStored.mockReset().mockResolvedValue({
		version: 7,
		balance: "1200.00",
		closed: false,
	});
	mockBook.mockReset().mockResolvedValue({
		bookedAt: 1,
		changes: [],
		changed: [],
		base: null,
		accountBase: { version: 7, balance: "1200.00" },
	});
	mockToast.show.mockClear();
	mockShowAlert.mockReset();
	forgetUndoTokens();
	forgetSent();
	forgetNotFound("k1");
});

/** Queues a balance update of Galicia that the server then refuses with `answer`. */
async function parkedBalance(answer: Error) {
	const ctx = setup();
	await ctx.outbox.enqueue({
		clientId: "k1",
		entity: "accounts",
		kind: "balance",
		targetId: ID,
		baseVersion: "4",
		payload: {
			id: ID,
			balance: "1500.00",
			legId: "l1",
			rateTypeId: "r1",
			expectedBalance: "1000.00",
			title: "Galicia",
		},
	});
	ctx.accounts.updateBalance.mockRejectedValueOnce(answer);
	await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
	return { ...ctx, tree: await render() };
}

describe("Couldn't sync for a queued Wealth write", () => {
	it("a balance update that met another device's change reads Changed on another device, named by the account, with Try again and Discard", async () => {
		const { tree } = await parkedBalance(problem(409, "account_changed"));
		expect(said(tree)).toEqual(
			expect.arrayContaining(["Galicia", "sync.changed"]),
		);
		expect(buttons(tree)).toEqual(["retry, Galicia", "sync.discard, Galicia"]);
		act(() => tree.unmount());
	});

	it("Try again shows the dry run over the pulled account, and saving sends the statement again against that version and balance", async () => {
		const { tree, accounts, outbox } = await parkedBalance(
			problem(409, "account_changed"),
		);
		await press(tree, "retry, Galicia");
		// The dry run is of the same statement, checked against what the pull left.
		expect(accounts.previewUpdateBalance.mock.calls[0]?.[0]).toMatchObject({
			id: ID,
			balance: "1500.00",
			expectedVersion: 7,
			expectedBalance: "1200.00",
		});
		expect(mockShowAlert).toHaveBeenCalledTimes(1);
		const buttonsOf = mockShowAlert.mock.calls[0]?.[2] as {
			text: string;
			onPress?: () => Promise<void>;
		}[];
		await act(async () => {
			await buttonsOf[1]?.onPress?.();
		});
		expect(accounts.updateBalance).toHaveBeenCalledTimes(2);
		expect(accounts.updateBalance.mock.calls[1]?.[0]).toMatchObject({
			id: ID,
			balance: "1500.00",
			expectedVersion: 7,
			expectedBalance: "1200.00",
		});
		// New keys and leg ids; the account's name and nothing else not in the body is not sent.
		expect(accounts.updateBalance.mock.calls[1]?.[0]).not.toHaveProperty(
			"title",
		);
		expect(await outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});

	it("Discard takes the parked write off the phone", async () => {
		const { tree, outbox } = await parkedBalance(
			problem(409, "account_changed"),
		);
		await press(tree, "sync.discard, Galicia");
		expect(await outbox.all()).toEqual([]);
		expect(mockToast.show).toHaveBeenCalledWith({
			message: "toast.discarded",
		});
		act(() => tree.unmount());
	});

	it("a whole-account edit that met a change is Discard only", async () => {
		const ctx = setup();
		await ctx.outbox.enqueue({
			clientId: "k1",
			entity: "accounts",
			kind: "update",
			targetId: ID,
			baseVersion: "4",
			payload: { id: ID, name: "Galicia main", balance: "100.00" },
		});
		ctx.accounts.update.mockRejectedValueOnce(problem(409, "account_changed"));
		await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
		const tree = await render();
		expect(said(tree)).toEqual(
			expect.arrayContaining(["Galicia main", "sync.changed"]),
		);
		expect(buttons(tree)).toEqual(["sync.discard, Galicia main"]);
		act(() => tree.unmount());
	});

	it("a new account that met a taken id counts as sent: nothing is parked", async () => {
		const ctx = setup();
		await ctx.outbox.enqueue({
			clientId: "k1",
			entity: "accounts",
			kind: "create",
			targetId: "k1",
			baseVersion: null,
			payload: { name: "Cash", currency: "ARS", balance: "1.00" },
		});
		ctx.accounts.create.mockRejectedValueOnce(problem(409, "id_taken"));
		await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
		const tree = await render();
		expect(said(tree)).toEqual([]);
		expect(await ctx.outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});

	it("a balance update whose leg id is taken shows the refusal line, and Try again saves it again under fresh ids", async () => {
		const { tree, accounts } = await parkedBalance(problem(409, "id_taken"));
		expect(said(tree)).toEqual(
			expect.arrayContaining(["Galicia", "sync.refused"]),
		);
		expect(buttons(tree)).toEqual(["retry, Galicia", "sync.discard, Galicia"]);
		await press(tree, "retry, Galicia");
		const buttonsOf = mockShowAlert.mock.calls[0]?.[2] as {
			onPress?: () => Promise<void>;
		}[];
		await act(async () => {
			await buttonsOf[1]?.onPress?.();
		});
		const second = accounts.updateBalance.mock.calls[1]?.[0] as {
			legId: string;
			rateTypeId: string;
		};
		expect(second.legId).not.toBe("l1");
		expect(second.rateTypeId).not.toBe("r1");
		act(() => tree.unmount());
	});

	it("a refused new account (400) can be sent again as it is", async () => {
		const ctx = setup();
		await ctx.outbox.enqueue({
			clientId: "k1",
			entity: "accounts",
			kind: "create",
			targetId: "k1",
			baseVersion: null,
			payload: { name: "Cash", currency: "ARS", balance: "1.00" },
		});
		ctx.accounts.create.mockRejectedValueOnce(problem(400, "bad_request"));
		await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
		const tree = await render();
		expect(said(tree)).toContain("sync.refused");
		expect(buttons(tree)).toEqual(["retry, Cash", "sync.discard, Cash"]);
		await press(tree, "retry, Cash");
		expect(ctx.accounts.create).toHaveBeenCalledTimes(2);
		expect(await ctx.outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});

	it("a refused transfer is named by its label and shows what left the source", async () => {
		const ctx = setup();
		await ctx.outbox.enqueue({
			clientId: "k1",
			entity: "transfers",
			kind: "create",
			targetId: "k1",
			baseVersion: null,
			payload: {
				id: "k1",
				fromAmount: "50.00",
				fromCurrency: "ARS",
				title: "Savings",
			},
		});
		ctx.transfers.create.mockRejectedValueOnce(problem(400, "bad_request"));
		await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
		const tree = await render();
		expect(said(tree)).toEqual(expect.arrayContaining(["Savings", "ARS 5000"]));
		// The label is the phone's; the body that went out had none.
		expect(ctx.transfers.create.mock.calls[0]?.[0]).not.toHaveProperty("title");
		act(() => tree.unmount());
	});
});

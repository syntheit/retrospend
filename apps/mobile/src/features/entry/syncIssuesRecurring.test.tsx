import type { RetrospendClient } from "@retrospend/api-client";
import type { TemplateSeen } from "@retrospend/engine/device";
import { createOutbox, type Outbox } from "@/data/outbox";
import { confirm } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { flushEntries } from "./queue";
import { SyncIssues } from "./SyncIssues";
import {
	apiTransport,
	forgetNotFound,
	forgetUndoTokens,
	PARKED_NOT_FOUND,
	RECURRING_ALREADY_POSTED,
	RECURRING_CHANGED,
	RECURRING_NOT_DUE,
} from "./send";
import { forgetSent } from "./sentRetain";

// What Couldn't sync shows for a person's recurring confirm or skip, by what
// the server answered and what the next pull showed of the template: the real
// sender classifies the answer, the real outbox parks it, the real list reads
// it back. Words are the catalog keys (use-intl is the identity here).

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
const mockSince = jest.fn();
const mockBook = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => ({
		templateSince: mockSince,
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
		format: (m: { minor: number }) => `USD ${m.minor}`,
	}),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

const STAMP = "2026-11-18T10:00:00.000Z";
const V2 = "2026-11-25T08:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";
const NEXT = "2026-12-02T10:00:00.000Z";

const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });
const seen = (over: Partial<Extract<TemplateSeen, { found: true }>> = {}) =>
	({
		found: true,
		paused: false,
		passed: false,
		posted: false,
		version: V2,
		currency: "USD",
		amountMode: "ASK",
		...over,
	}) as TemplateSeen;
const GONE: TemplateSeen = { found: false };

function setup() {
	const recurring = {
		confirm: jest.fn(async (_input: unknown, _options: unknown) => ({
			undo: "tok",
			confirmed: { templateUpdatedAt: NEXT },
		})),
		skip: jest.fn(async (_input: unknown, _options: unknown) => ({
			undo: "tok",
			skipped: { templateUpdatedAt: NEXT },
		})),
		previewConfirm: jest.fn(async (_input: unknown, _options: unknown) => ({
			changes: [],
			unchanged: [],
			unavailable: [],
		})),
		previewSkip: jest.fn(async (_input: unknown, _options: unknown) => ({
			changes: [],
			unchanged: [],
			unavailable: [],
		})),
	};
	const api = { recurring } as never as RetrospendClient;
	const outbox = createOutbox(createMemoryStore(), "scope");
	mockSession.api = api;
	mockSession.local = { outbox };
	return { api, recurring, outbox };
}

/** Queues a person's confirm or skip of t1, sends it, and renders Couldn't sync. */
async function show(
	answer: Error | null,
	template: TemplateSeen | null,
	kind: "confirm" | "skip" = "confirm",
) {
	const ctx = setup();
	await ctx.outbox.enqueue({
		...confirm("c1", "t1", STAMP, {
			payload: { dueAt: DUE, title: "Netflix", currency: "USD" },
		}),
		kind,
	});
	if (answer) ctx.recurring[kind].mockRejectedValue(answer);
	mockSince.mockResolvedValue(template);
	await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
	let tree!: Tree;
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	return { ...ctx, tree };
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
const TRY = "retry, Netflix";
const DISCARD = "sync.discard, Netflix";

beforeEach(() => {
	mockNextId = 0;
	mockSince.mockReset();
	mockBook.mockReset().mockResolvedValue({
		bookedAt: 1,
		changes: [],
		changed: [],
		base: V2,
	});
	mockToast.show.mockClear();
	mockShowAlert.mockReset();
	forgetUndoTokens();
	forgetSent();
	forgetNotFound("c1");
});

describe("Couldn't sync for a recurring confirm", () => {
	it("recurring_changed with the template still due: Changed on another device, with Try again and Discard", async () => {
		const { tree } = await show(problem(409, RECURRING_CHANGED), seen());
		expect(said(tree)).toEqual(
			expect.arrayContaining(["Netflix", "sync.changed"]),
		);
		expect(buttons(tree)).toEqual([TRY, DISCARD]);
		act(() => tree.unmount());
	});

	it("recurring_already_posted with no expense of ours in the pull: Changed on another device, Discard only", async () => {
		const { tree } = await show(
			problem(409, RECURRING_ALREADY_POSTED),
			seen({ passed: true, posted: false }),
		);
		expect(said(tree)).toContain("sync.changed");
		expect(buttons(tree)).toEqual([DISCARD]);
		act(() => tree.unmount());
	});

	it("recurring_already_posted with our expense in the pull leaves without a word", async () => {
		const { tree, outbox } = await show(
			problem(409, RECURRING_ALREADY_POSTED),
			seen({ passed: true, posted: true }),
		);
		expect(said(tree)).toEqual([]);
		expect(await outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});

	it("404 with the template gone from a later pull: Deleted on another device, Discard only", async () => {
		const { tree } = await show(problem(404, PARKED_NOT_FOUND), GONE);
		expect(said(tree)).toContain("sync.deleted");
		expect(buttons(tree)).toEqual([DISCARD]);
		act(() => tree.unmount());
	});

	it("404 with the template back (an Undo on the web): Couldn't sync with Try again and Discard", async () => {
		const { tree } = await show(problem(404, PARKED_NOT_FOUND), seen());
		expect(said(tree)).toContain("sync.refused");
		expect(buttons(tree)).toEqual([TRY, DISCARD]);
		act(() => tree.unmount());
	});

	it("404 before any pull has finished stays Couldn't sync with Try again", async () => {
		const { tree } = await show(problem(404, PARKED_NOT_FOUND), null);
		expect(said(tree)).toContain("sync.refused");
		expect(buttons(tree)).toEqual([TRY, DISCARD]);
		act(() => tree.unmount());
	});

	it("a template paused elsewhere: Changed on another device, Discard only", async () => {
		const { tree } = await show(
			problem(409, RECURRING_CHANGED),
			seen({ paused: true }),
		);
		expect(said(tree)).toContain("sync.changed");
		expect(buttons(tree)).toEqual([DISCARD]);
		act(() => tree.unmount());
	});

	it("an id the server holds for another row: Couldn't sync, resent as it is", async () => {
		const { tree, recurring } = await show(problem(409, "id_taken"), seen());
		expect(said(tree)).toContain("sync.refused");
		expect(buttons(tree)).toEqual([TRY, DISCARD]);
		// Not re-based: the same key goes out again.
		await press(tree, TRY);
		expect(mockShowAlert).not.toHaveBeenCalled();
		expect(recurring.confirm).toHaveBeenCalledTimes(2);
		act(() => tree.unmount());
	});

	it("a not-yet answer is no Sync issue at all: the entry waits", async () => {
		const { tree, outbox } = await show(
			problem(409, RECURRING_NOT_DUE),
			seen(),
		);
		expect(said(tree)).toEqual([]);
		expect(await outbox.all()).toHaveLength(1);
		act(() => tree.unmount());
	});

	it("a skip parks the same way: its row names it and offers Try again", async () => {
		const { tree } = await show(
			problem(409, RECURRING_CHANGED),
			seen(),
			"skip",
		);
		expect(said(tree)).toContain("sync.changed");
		expect(buttons(tree)).toEqual([TRY, DISCARD]);
		act(() => tree.unmount());
	});
});

describe("Try again and Discard on a recurring row", () => {
	it("Try again shows the dry run over the pulled version, and Confirm sends it under a new id and that stamp", async () => {
		const { tree, recurring, outbox } = await show(
			problem(409, RECURRING_CHANGED),
			seen(),
		);
		recurring.confirm.mockResolvedValue({
			undo: "tok",
			confirmed: { templateUpdatedAt: NEXT },
		});
		await press(tree, TRY);
		expect(recurring.previewConfirm.mock.calls[0]?.[0]).toEqual({
			id: "t1",
			dueAt: DUE,
			expectedUpdatedAt: V2,
		});
		const [title, , actions] = mockShowAlert.mock.calls[0] as [
			string,
			string | undefined,
			{ text: string; onPress?: () => Promise<void> }[],
		];
		expect(title).toBe("sync.rebaseConfirm");
		expect(actions.map((a) => a.text)).toEqual(["cancel", "confirm.submit"]);
		// Nothing is sent unseen: the old entry is still parked.
		expect(recurring.confirm).toHaveBeenCalledTimes(1);
		await act(async () => {
			await actions[1]?.onPress?.();
		});
		expect(recurring.confirm).toHaveBeenCalledTimes(2);
		expect(recurring.confirm.mock.calls[1]?.[0]).toEqual({
			id: "t1",
			dueAt: DUE,
			expectedUpdatedAt: V2,
			expenseId: "new-1",
		});
		expect(await outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});

	it("Try again on a skip asks Skip again", async () => {
		const { tree, recurring } = await show(
			problem(409, RECURRING_CHANGED),
			seen(),
			"skip",
		);
		await press(tree, TRY);
		expect(recurring.previewSkip.mock.calls[0]?.[0]).toEqual({
			id: "t1",
			dueAt: DUE,
			expectedUpdatedAt: V2,
		});
		const [title, , actions] = mockShowAlert.mock.calls[0] as [
			string,
			unknown,
			{ text: string }[],
		];
		expect(title).toBe("sync.rebaseSkip");
		expect(actions.map((a) => a.text)).toEqual(["cancel", "skip.submit"]);
		act(() => tree.unmount());
	});

	it("Try again that cannot be previewed says so and sends nothing", async () => {
		const { tree, recurring } = await show(
			problem(409, RECURRING_CHANGED),
			seen(),
		);
		recurring.previewConfirm.mockRejectedValue(new Error("offline"));
		await press(tree, TRY);
		expect(mockShowAlert).not.toHaveBeenCalled();
		expect(mockToast.show).toHaveBeenCalledWith({
			message: "sync.retryFailed",
		});
		expect(recurring.confirm).toHaveBeenCalledTimes(1);
		act(() => tree.unmount());
	});

	it("Discard takes the parked entry out", async () => {
		const { tree, outbox } = await show(
			problem(409, RECURRING_CHANGED),
			seen(),
		);
		await press(tree, DISCARD);
		expect(await outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});
});

describe("a typed amount that no longer fits the template", () => {
	it("an ARS amount on a template that is USD now: Changed on another device, Discard only", async () => {
		const ctx = setup();
		await ctx.outbox.enqueue(
			confirm("c1", "t1", STAMP, {
				payload: {
					dueAt: DUE,
					amount: "15000",
					currency: "ARS",
					title: "Netflix",
				},
			}),
		);
		ctx.recurring.confirm.mockRejectedValue(problem(409, RECURRING_CHANGED));
		mockSince.mockResolvedValue(seen({ currency: "USD" }));
		await flushEntries(ctx.outbox, ctx.api, apiTransport(ctx.api));
		let tree!: Tree;
		await act(async () => {
			tree = create(<SyncIssues />);
		});
		expect(said(tree)).toContain("sync.changed");
		expect(buttons(tree)).toEqual([DISCARD]);
		act(() => tree.unmount());
	});
});

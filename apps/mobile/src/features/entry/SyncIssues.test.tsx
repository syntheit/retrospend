import { SyncIssues } from "./SyncIssues";

// Screen readers skip what sits inside an `accessible` view, so Try again and
// Discard must not be wrapped in one with the entry's words.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	parent: TestNode | null;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockEntries: Record<string, unknown>[] = [];
const mockRebase = jest.fn();
jest.mock("./parked", () => ({
	useParkedEntries: () => ({
		entries: mockEntries,
		retry: jest.fn(),
		rebase: mockRebase,
		discard: jest.fn(),
	}),
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
const mockShowAlert = jest.fn();
jest.mock("@/ui/alert", () => ({
	showAlert: (...args: unknown[]) => mockShowAlert(...args),
}));

const coffee = {
	clientId: "c1",
	title: "Coffee",
	amount: { minor: 350000, currency: "ARS" },
	reason: "forbidden",
	kind: "create",
	gone: false,
	retryable: true,
};
beforeEach(() => {
	mockRebase.mockReset();
	mockShowAlert.mockReset();
	mockEntries.splice(0, mockEntries.length, coffee);
});
jest.mock("@/lib/money", () => ({
	useFormatMoney: () => ({ format: () => "ARS 3,500.00" }),
}));
jest.mock("@/ui/Toast", () => ({
	useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

function insideAccessible(node: TestNode): boolean {
	for (let up = node.parent; up; up = up.parent) {
		if (up.props.accessible === true) return true;
	}
	return false;
}

it("keeps Try again and Discard reachable by a screen reader", async () => {
	let tree!: { root: TestNode; unmount(): void };
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	const buttons = tree.root.findAll(
		(n) =>
			n.props.accessibilityRole === "button" &&
			typeof n.props.onPress === "function" &&
			typeof n.props.accessibilityLabel === "string",
	);
	const labels = [...new Set(buttons.map((b) => b.props.accessibilityLabel))];
	expect(labels).toEqual(["retry, Coffee", "sync.discard, Coffee"]);
	for (const button of buttons) expect(insideAccessible(button)).toBe(false);
	// The entry's words are still one stop.
	expect(
		tree.root.findAll((n) => n.props.accessible === true).length,
	).toBeGreaterThan(0);
	act(() => tree.unmount());
});

async function labelsOf(entry: Record<string, unknown>) {
	mockEntries.splice(0, mockEntries.length, entry);
	let tree!: { root: TestNode; unmount(): void };
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	const labels = tree.root
		.findAll(
			(n) =>
				n.props.accessibilityRole === "button" &&
				typeof n.props.accessibilityLabel === "string",
		)
		.map((b) => b.props.accessibilityLabel);
	const said = tree.root
		.findAll((n) => typeof n.props.children === "string")
		.map((n) => n.props.children);
	act(() => tree.unmount());
	return { labels: [...new Set(labels)], said };
}

it("says another device changed it, and keeps Try again and Discard", async () => {
	const { labels, said } = await labelsOf({
		...coffee,
		reason: "expense_changed",
		kind: "update",
	});
	expect(said).toContain("sync.changed");
	expect(labels).toEqual(["retry, Coffee", "sync.discard, Coffee"]);
});

it("says another device deleted it, with Discard only", async () => {
	const { labels, said } = await labelsOf({
		...coffee,
		reason: "not_found",
		kind: "update",
		gone: true,
	});
	expect(said).toContain("sync.deleted");
	expect(labels).toEqual(["sync.discard, Coffee"]);
});

it("names a delete, which has no title, as the delete it is", async () => {
	const { labels } = await labelsOf({
		...coffee,
		title: "",
		kind: "delete",
		reason: "expense_changed",
	});
	expect(labels).toEqual(["retry, button", "sync.discard, button"]);
});

it("Try again on a changed row shows the dry run of the re-based write, and sends only on Save", async () => {
	mockEntries.splice(0, mockEntries.length, {
		...coffee,
		reason: "expense_changed",
		kind: "update",
	});
	const save = jest.fn(async () => true);
	mockRebase.mockResolvedValue({
		kind: "update",
		// Only the wiring: what the dry run's lines say. The numbers a re-base
		// previews are derived on the real engine in conflictVector.test.
		diff: {
			changes: [
				{
					id: "spent",
					currency: "ARS",
					delta: { minor: 6_180_000, currency: "ARS" },
					after: null,
				},
			],
			unchanged: [],
			unavailable: [],
		},
		save,
	});
	let tree!: { root: TestNode; unmount(): void };
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	const retry = tree.root.findAll(
		(n) =>
			typeof n.props.onPress === "function" &&
			n.props.accessibilityLabel === "retry, Coffee",
	)[0] as TestNode;
	await act(async () => {
		await (retry.props.onPress as () => Promise<void>)();
	});
	expect(mockRebase).toHaveBeenCalledWith("c1");
	expect(save).not.toHaveBeenCalled();
	const [title, message, buttons] = mockShowAlert.mock.calls[0] as [
		string,
		string,
		{ text: string; onPress?: () => Promise<void> }[],
	];
	expect(title).toBe("sync.rebaseTitle");
	expect(message).toBe("spent 6180000");
	await act(async () => {
		await buttons[1]?.onPress?.();
	});
	expect(save).toHaveBeenCalledTimes(1);
	act(() => tree.unmount());
});

it("Try again on a changed row that cannot be previewed sends nothing", async () => {
	mockEntries.splice(0, mockEntries.length, {
		...coffee,
		reason: "expense_changed",
		kind: "update",
	});
	mockRebase.mockResolvedValue(null);
	let tree!: { root: TestNode; unmount(): void };
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	const retry = tree.root.findAll(
		(n) =>
			typeof n.props.onPress === "function" &&
			n.props.accessibilityLabel === "retry, Coffee",
	)[0] as TestNode;
	await act(async () => {
		await (retry.props.onPress as () => Promise<void>)();
	});
	expect(mockShowAlert).not.toHaveBeenCalled();
	act(() => tree.unmount());
});

it("says an earlier change never synced in its own words, and offers Try again", async () => {
	const { labels, said } = await labelsOf({
		...coffee,
		reason: "chain_lost",
		kind: "update",
	});
	expect(said).toContain("sync.lost");
	expect(said).not.toContain("sync.refused");
	expect(labels).toEqual(["retry, Coffee", "sync.discard, Coffee"]);
});

it("an edit with no booking, whose changed fields are unknown, offers Discard only", async () => {
	const { labels } = await labelsOf({
		...coffee,
		reason: "expense_changed",
		kind: "update",
		retryable: false,
	});
	expect(labels).toEqual(["sync.discard, Coffee"]);
});

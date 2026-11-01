import { AccountScreen } from "./AccountScreen";

const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockState: { me: Record<string, unknown> } = { me: {} };
const mockApi = {
	admin: {
		listFeedback: jest.fn(async () => ({ counts: { unread: 3 }, items: [] })),
	},
};

jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: mockApi,
		state: { status: "signedIn", me: mockState.me },
	}),
}));
jest.mock("@/auth/server-connection", () => ({
	useServerBaseUrl: () => "https://retrospend.test/",
}));
const mockPush = jest.fn();
const mockGoBack = jest.fn();
jest.mock("expo-router", () => ({
	router: { push: (to: string) => mockPush(to) },
	usePathname: () => "/account",
	useNavigation: () => ({ getParent: () => ({ goBack: mockGoBack }) }),
	Stack: { Screen: () => null },
}));
jest.mock("@/features/feedback/FeedbackProvider", () => ({
	useFeedback: () => ({ open: jest.fn() }),
}));
jest.mock("@/features/settings/webPages", () => ({ openWebPage: jest.fn() }));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string, values?: { count?: number }) =>
		values?.count === undefined ? key : `${key}:${values.count}`,
}));
jest.mock("./useSignOut", () => ({ useSignOut: () => () => {} }));

type Node = { props: Record<string, unknown> & { onPress?: () => void } };
type Tree = {
	root: { findAll(f: (n: Node) => boolean): Node[] };
	unmount(): void;
};

async function render(me: Record<string, unknown>): Promise<Tree> {
	mockState.me = me;
	let tree!: Tree;
	await act(async () => {
		tree = create(<AccountScreen />);
	});
	return tree;
}

async function labels(me: Record<string, unknown>): Promise<string[]> {
	const tree = await render(me);
	const texts = tree.root
		.findAll((n) => typeof n.props.children === "string")
		.map((n) => n.props.children as string);
	act(() => tree.unmount());
	return texts;
}

const member = {
	id: "m",
	name: "Sofía Reyes",
	email: "s@x.test",
	role: "USER",
	canInvite: false,
	principal: { scopes: [] },
};

describe("account sheet", () => {
	it("leaves Notifications to the bell on Home, and shows no Admin group to a member", async () => {
		const texts = await labels(member);
		expect(texts).not.toContain("notifications");
		expect(texts).not.toContain("admin");
		expect(texts).not.toContain("feedbackInbox");
	});

	it("opens its places inside the sheet", async () => {
		const tree = await render(member);
		const row = (title: string) =>
			tree.root.findAll((n) => n.props.title === title && !!n.props.onPress)[0];
		await act(async () => {
			row("Sofía Reyes")?.props.onPress?.();
		});
		expect(mockPush).toHaveBeenLastCalledWith("/account/profile");
		await act(async () => {
			row("currencies")?.props.onPress?.();
		});
		expect(mockPush).toHaveBeenLastCalledWith("/account/currencies");
		await act(async () => {
			row("settings")?.props.onPress?.();
		});
		expect(mockPush).toHaveBeenLastCalledWith("/account/settings");
		act(() => tree.unmount());
	});

	it("shows Admin, Invite codes and Feedback inbox with its count for an admin", async () => {
		const texts = await labels({
			...member,
			role: "ADMIN",
			canInvite: true,
			principal: { scopes: ["admin"] },
		});
		expect(texts).toContain("admin");
		expect(texts).toContain("inviteCodes");
		expect(texts).toContain("feedbackInbox");
		expect(texts).toContain("newCount:3");
	});

	it("offers Invite codes to a member the server lets invite, and hides the row otherwise", async () => {
		const allowed = await labels({ ...member, canInvite: true });
		expect(allowed).toContain("inviteCodes");
		expect(allowed).not.toContain("admin");
		expect(await labels(member)).not.toContain("inviteCodes");
	});

	it("keeps Admin out until an admin signs in again with the admin scope", async () => {
		const texts = await labels({ ...member, role: "ADMIN" });
		expect(texts).not.toContain("admin");
	});
});

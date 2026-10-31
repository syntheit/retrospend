import { AccountTopBar } from "./AccountTopBar";

const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockState: { me: Record<string, unknown> } = { me: {} };
const mockApi = {
	notifications: { unreadCount: jest.fn(async () => ({ count: 2 })) },
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
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/features/feedback/FeedbackProvider", () => ({
	useFeedback: () => ({ open: jest.fn() }),
}));
jest.mock("@/features/settings/webPages", () => ({ openWebPage: jest.fn() }));
jest.mock("@/ui/TopBar", () => {
	const { Pressable } = require("react-native");
	return {
		TopBar: ({ onAccountPress }: { onAccountPress: () => void }) => (
			<Pressable accessibilityLabel="open" onPress={onAccountPress} />
		),
	};
});
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ visible, children }: { visible: boolean; children: unknown }) =>
		visible ? children : null,
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string, values?: { count?: number }) =>
		values?.count === undefined ? key : `${key}:${values.count}`,
}));
jest.mock("./useSignOut", () => ({ useSignOut: () => () => {} }));

async function labels(me: Record<string, unknown>): Promise<string[]> {
	mockState.me = me;
	let tree!: {
		root: {
			findAll(f: (n: { props: Record<string, unknown> }) => boolean): {
				props: Record<string, unknown>;
			}[];
			findByProps(p: Record<string, unknown>): {
				props: { onPress: () => void };
			};
		};
		unmount(): void;
	};
	await act(async () => {
		tree = create(<AccountTopBar title="Home" />);
	});
	await act(async () => {
		tree.root.findByProps({ accessibilityLabel: "open" }).props.onPress();
	});
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
	it("shows Notifications with its unread count for a member, and no Admin group", async () => {
		const texts = await labels(member);
		expect(texts).toContain("notifications");
		expect(texts).toContain("newCount:2");
		expect(texts).not.toContain("admin");
		expect(texts).not.toContain("feedbackInbox");
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

	it("scrolls on iOS, so Sign out and the version are reachable under the detent", async () => {
		const { Platform, ScrollView } = require("react-native");
		const was = Platform.OS;
		Platform.OS = "ios";
		mockState.me = {
			...member,
			role: "ADMIN",
			principal: { scopes: ["admin"] },
		};
		let tree!: {
			root: {
				findAllByType(t: unknown): {
					findAll(
						f: (n: { props: Record<string, unknown> }) => boolean,
					): unknown[];
				}[];
				findByProps(p: Record<string, unknown>): {
					props: { onPress: () => void };
				};
			};
			unmount(): void;
		};
		try {
			await act(async () => {
				tree = create(<AccountTopBar title="Home" />);
			});
			await act(async () => {
				tree.root.findByProps({ accessibilityLabel: "open" }).props.onPress();
			});
			const scrolls = tree.root.findAllByType(ScrollView);
			expect(scrolls).toHaveLength(1);
			const [scroll] = scrolls;
			const inside = (scroll?.findAll((n) => n.props.children === "signOut") ?? [])
				.concat(scroll?.findAll((n) => n.props.children === "version") ?? []);
			expect(inside.length).toBeGreaterThan(0);
		} finally {
			Platform.OS = was;
			act(() => tree.unmount());
		}
	});

	it("keeps Admin out until an admin signs in again with the admin scope", async () => {
		const texts = await labels({ ...member, role: "ADMIN" });
		expect(texts).not.toContain("admin");
	});
});

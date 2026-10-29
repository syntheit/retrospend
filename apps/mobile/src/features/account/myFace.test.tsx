import { Image } from "react-native";
import { AccountButton } from "@/ui/AccountButton";
import { useMyFace } from "./AccountTopBar";

// The account button showed initials only: the picture the server sends is a
// path (/api/images/avatars/...), which the phone must load from the server.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockMe: Record<string, unknown> = {
	id: "me1",
	name: "Sofía Reyes",
	avatarUrl: "/api/images/avatars/me1-1730000000.webp",
	image: null,
};
const mockBase: { url: string | null } = { url: "https://retrospend.test/" };

jest.mock("@/auth/session", () => ({
	useSession: () => ({ state: { status: "signedIn", me: mockMe } }),
}));
jest.mock("@/auth/server-connection", () => ({
	useServerBaseUrl: () => mockBase.url,
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("@/ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("use-intl", () => ({ useTranslations: () => (key: string) => key }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("./useSignOut", () => ({ useSignOut: () => () => {} }));

function Probe() {
	const face = useMyFace();
	return face ? <AccountButton face={face} label="Account" /> : null;
}

function imageUris() {
	let tree!: {
		root: {
			findAllByType(t: unknown): { props: { source: { uri: string } } }[];
		};
		unmount(): void;
	};
	act(() => {
		tree = create(<Probe />);
	});
	const uris = tree.root.findAllByType(Image).map((i) => i.props.source.uri);
	act(() => tree.unmount());
	return uris;
}

describe("your face on the account button", () => {
	afterEach(() => {
		mockMe.avatarUrl = "/api/images/avatars/me1-1730000000.webp";
		mockMe.image = null;
		mockBase.url = "https://retrospend.test/";
	});

	it("loads the uploaded picture from the connected server", () => {
		expect(imageUris()).toEqual([
			"https://retrospend.test/api/images/avatars/me1-1730000000.webp",
		]);
	});

	it("falls back to the sign-in provider's picture", () => {
		mockMe.avatarUrl = null;
		mockMe.image = "https://images.example/sofia.png";
		expect(imageUris()).toEqual(["https://images.example/sofia.png"]);
	});

	it("shows initials when there is no picture or no server to load it from", () => {
		mockMe.avatarUrl = null;
		expect(imageUris()).toEqual([]);
		mockMe.avatarUrl = "/api/images/avatars/me1.webp";
		mockBase.url = null;
		expect(imageUris()).toEqual([]);
	});
});

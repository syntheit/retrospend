import { createElement } from "react";
import Index from "../app/index";

// Opening the app: nothing is redirected while the saved server or the
// session is still being read, so sign-in never flashes on the way to Home.
const { act, create } = require("react-test-renderer");

let mockConnection: { status: string } = { status: "loading" };
let mockSession: { status: string } = { status: "loading" };

jest.mock("expo-router", () => ({
	Redirect: (props: object) =>
		require("react").createElement("Redirect", props),
}));
jest.mock("@/auth/server-connection", () => ({
	useServerConnection: () => ({ connection: mockConnection }),
}));
jest.mock("@/auth/session", () => ({
	useSession: () => ({ state: mockSession }),
}));

function href(): string | null {
	let tree!: { toJSON(): { props: { href: string } } | null };
	act(() => {
		tree = create(createElement(Index));
	});
	return tree.toJSON()?.props.href ?? null;
}

describe("Index", () => {
	it.each([
		["loading", "loading", null],
		["connected", "loading", null],
		["none", "signedOut", "/connect"],
		["connected", "signedOut", "/sign-in"],
		["connected", "signedIn", "/home"],
	] as const)("%s server, %s session: %s", (connection, session, to) => {
		mockConnection = { status: connection };
		mockSession = { status: session };
		expect(href()).toBe(to);
	});
});

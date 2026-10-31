import { opensWebPage } from "./joinLink";

const read = (patch: Partial<Parameters<typeof opensWebPage>[0]>) => ({
	fromLink: true,
	status: "ready" as const,
	refreshing: false,
	myRole: null as string | null,
	...patch,
});

describe("a project link", () => {
	it("stays in the app when the project was opened from inside it", () => {
		expect(opensWebPage(read({ fromLink: false }))).toBe(false);
		expect(opensWebPage(read({ fromLink: false, status: "error" }))).toBe(false);
	});

	it("waits for the server before deciding", () => {
		expect(opensWebPage(read({ status: "loading" }))).toBe(false);
		expect(opensWebPage(read({ refreshing: true }))).toBe(false);
	});

	it("opens the web page for a project you are not in", () => {
		expect(opensWebPage(read({ myRole: null }))).toBe(true);
		expect(opensWebPage(read({ status: "error" }))).toBe(true);
	});

	it("opens the project itself when you are a member", () => {
		expect(opensWebPage(read({ myRole: "CONTRIBUTOR" }))).toBe(false);
		expect(opensWebPage(read({ myRole: "VIEWER" }))).toBe(false);
	});
});

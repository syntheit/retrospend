import type { InviteInfo } from "./guestApi";
import {
	type GuestRecord,
	parseProjectLink,
	serverParam,
	stepFor,
} from "./sharedAccess";

const ID = "3f1c2b4a-1111-4222-8333-444455556666";

const info = (over: Partial<InviteInfo> = {}): InviteInfo => ({
	projectId: ID,
	projectName: "Trip",
	projectDescription: null,
	projectImagePath: null,
	participantCount: 3,
	roleGranted: "CONTRIBUTOR",
	...over,
});

const record = (over: Partial<GuestRecord> = {}): GuestRecord => ({
	baseUrl: "https://retrospend.app",
	projectId: ID,
	projectName: "Trip",
	token: null,
	sessionId: null,
	viewerLink: null,
	name: null,
	...over,
});

describe("parseProjectLink", () => {
	it("reads a web address with its invite and server", () => {
		expect(
			parseProjectLink(`https://retrospend.app/projects/${ID}?invite=abc`),
		).toEqual({
			id: ID,
			invite: "abc",
			resume: null,
			server: "https://retrospend.app",
		});
	});

	it("keeps a port and a plain http server", () => {
		expect(
			parseProjectLink(` http://192.168.1.5:1997/projects/${ID} `)?.server,
		).toBe("http://192.168.1.5:1997");
	});

	it("reads the app's own address and its server hint", () => {
		expect(
			parseProjectLink(
				`retrospend://projects/${ID}?invite=abc&server=https%3A%2F%2Fexample.org`,
			),
		).toEqual({
			id: ID,
			invite: "abc",
			resume: null,
			server: "https://example.org",
		});
	});

	it("reads a resume link", () => {
		expect(
			parseProjectLink(`https://x.org/projects/${ID}?guestResume=tok`)?.resume,
		).toBe("tok");
	});

	it("refuses anything that is not a project address", () => {
		expect(parseProjectLink("hello")).toBeNull();
		expect(parseProjectLink("https://retrospend.app/people/abc")).toBeNull();
		expect(parseProjectLink("https://retrospend.app/projects")).toBeNull();
		expect(
			parseProjectLink(`https://retrospend.app/projects/${ID}/extra`),
		).toBeNull();
		expect(parseProjectLink("https://retrospend.app/projects/x")).toBeNull();
	});
});

describe("serverParam", () => {
	it("keeps only a plain origin", () => {
		expect(serverParam("https://a.org/")).toBe("https://a.org");
		expect(serverParam("https://a.org/path")).toBeNull();
		expect(serverParam("javascript:alert(1)")).toBeNull();
		expect(serverParam(null)).toBeNull();
	});
});

describe("stepFor", () => {
	it("opens what the phone holds when there is no invite", () => {
		const base = { projectId: ID, invite: null, info: undefined };
		expect(stepFor({ ...base, record: null })).toEqual({
			kind: "open",
			mode: "public",
		});
		expect(stepFor({ ...base, record: record({ token: "t" }) })).toEqual({
			kind: "open",
			mode: "guest",
		});
		expect(stepFor({ ...base, record: record({ viewerLink: "v" }) })).toEqual({
			kind: "open",
			mode: "viewer",
		});
	});

	it("waits while the invite is being read", () => {
		expect(
			stepFor({ projectId: ID, invite: "i", info: undefined, record: null }),
		).toBeNull();
	});

	it("refuses an invite that does not work or is for another project", () => {
		expect(
			stepFor({ projectId: ID, invite: "i", info: null, record: null }),
		).toEqual({ kind: "inviteError", reason: "invalid" });
		expect(
			stepFor({
				projectId: ID,
				invite: "i",
				info: info({ projectId: "other" }),
				record: null,
			}),
		).toEqual({ kind: "inviteError", reason: "otherProject" });
	});

	it("remembers a viewer link without asking anything", () => {
		expect(
			stepFor({
				projectId: ID,
				invite: "i",
				info: info({ roleGranted: "VIEWER" }),
				record: null,
			}),
		).toEqual({ kind: "viewer", link: "i" });
	});

	it("asks to join, unless a guest session is already here", () => {
		expect(
			stepFor({ projectId: ID, invite: "i", info: info(), record: null }),
		).toEqual({ kind: "join", linkId: "i", info: info() });
		expect(
			stepFor({
				projectId: ID,
				invite: "i",
				info: info(),
				record: record({ token: "t" }),
			}),
		).toEqual({ kind: "open", mode: "guest" });
	});
});

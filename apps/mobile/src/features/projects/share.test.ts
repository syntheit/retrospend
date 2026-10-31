import {
	accessOf,
	activeLink,
	canManageLinks,
	canSetPublic,
	type MagicLink,
	projectPageUrl,
} from "./share";

const link = (patch: Partial<MagicLink>): MagicLink => ({
	id: "l1",
	roleGranted: "CONTRIBUTOR",
	url: "https://retrospend.app/projects/p1?invite=l1",
	isActive: true,
	expiresAt: null,
	maxUses: null,
	useCount: 0,
	createdAt: "2026-10-01T00:00:00.000Z",
	...patch,
});

describe("sharing a project", () => {
	it("finds the active link of a role", () => {
		const links = [
			link({ id: "old", isActive: false }),
			link({ id: "v", roleGranted: "VIEWER" }),
			link({ id: "c" }),
		];
		expect(activeLink(links, "CONTRIBUTOR")?.id).toBe("c");
		expect(activeLink(links, "VIEWER")?.id).toBe("v");
		expect(activeLink([link({ isActive: false })], "CONTRIBUTOR")).toBeNull();
	});

	it("lets Owners and Editors manage links, and only an Owner publish", () => {
		expect(canManageLinks("ORGANIZER")).toBe(true);
		expect(canManageLinks("EDITOR")).toBe(true);
		expect(canManageLinks("CONTRIBUTOR")).toBe(false);
		expect(canManageLinks(null)).toBe(false);
		expect(canSetPublic("ORGANIZER")).toBe(true);
		expect(canSetPublic("EDITOR")).toBe(false);
	});

	it("builds the page address on the connected server", () => {
		expect(projectPageUrl("https://retrospend.app/", "p1")).toBe(
			"https://retrospend.app/projects/p1",
		);
		expect(projectPageUrl("https://retrospend.app", "p1", "l 1")).toBe(
			"https://retrospend.app/projects/p1?invite=l%201",
		);
	});

	it("lists who can see what, widest last", () => {
		expect(accessOf({ links: [], isPublic: false })).toEqual([
			{ id: "members" },
			{ id: "public", on: false },
		]);
		expect(
			accessOf({
				links: [
					link({ roleGranted: "VIEWER" }),
					link({ id: "off", isActive: false }),
				],
				isPublic: true,
			}),
		).toEqual([
			{ id: "members" },
			{ id: "link", role: "VIEWER" },
			{ id: "public", on: true },
		]);
	});
});

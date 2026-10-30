import {
	adminAccess,
	filterUsers,
	firstLine,
	importJobChoices,
	inviteLink,
	userLabel,
	userStatus,
} from "./rules";
import type { AdminUser } from "./types";

function user(over: Partial<AdminUser>): AdminUser {
	return {
		id: "u",
		name: "Sofía Reyes",
		username: "sofia",
		email: "sofia@example.com",
		emailVerified: true,
		twoFactorEnabled: false,
		role: "USER",
		isActive: true,
		createdAt: "2026-01-01T00:00:00.000Z",
		expenseCount: 3,
		inviteCodesCount: 0,
		lastExpenseDate: "2026-10-28",
		hasBudget: false,
		hasRecurring: false,
		hasWealth: false,
		externalAiAllowed: null,
		...over,
	} as AdminUser;
}

describe("adminAccess", () => {
	it("offers nothing to a plain user or a signed-out phone", () => {
		expect(adminAccess(null)).toBe("none");
		expect(
			adminAccess({ role: "USER", principal: { scopes: ["read", "admin"] } }),
		).toBe("none");
	});

	it("asks an admin without the admin scope to sign in again", () => {
		expect(
			adminAccess({ role: "ADMIN", principal: { scopes: ["read"] } }),
		).toBe("signIn");
	});

	it("opens for an admin who holds the scope", () => {
		expect(
			adminAccess({ role: "ADMIN", principal: { scopes: ["read", "admin"] } }),
		).toBe("ok");
	});
});

describe("filterUsers", () => {
	const all = [
		user({ id: "a", username: "sofia" }),
		user({ id: "b", username: "Marco", email: "m@x.io", role: "ADMIN" }),
		user({ id: "c", username: null, email: "gone@x.io", isActive: false }),
		user({ id: "d", username: "pia", emailVerified: false }),
	];

	it("narrows by role, status and verification", () => {
		expect(filterUsers(all, "admins", "").map((u) => u.id)).toEqual(["b"]);
		expect(filterUsers(all, "disabled", "").map((u) => u.id)).toEqual(["c"]);
		expect(filterUsers(all, "unverified", "").map((u) => u.id)).toEqual(["d"]);
	});

	it("searches the username and the email in any case", () => {
		expect(filterUsers(all, "all", " MARCO ").map((u) => u.id)).toEqual(["b"]);
		expect(filterUsers(all, "all", "gone@").map((u) => u.id)).toEqual(["c"]);
		expect(filterUsers(all, "admins", "sofia")).toEqual([]);
	});
});

describe("userLabel", () => {
	it("names a person by the name they chose", () => {
		expect(userLabel(user({}))).toBe("Sofía Reyes");
	});

	it("falls back to the username, then the email", () => {
		expect(userLabel(user({ name: " " }))).toBe("sofia");
		expect(userLabel(user({ name: "", username: null }))).toBe(
			"sofia@example.com",
		);
	});

	it("is searchable by name", () => {
		expect(filterUsers([user({ id: "a" })], "all", "reyes")).toHaveLength(1);
	});
});

describe("userStatus", () => {
	it("calls a disabled account disabled whatever its activity", () => {
		expect(userStatus(user({ isActive: false }), "2026-10-30")).toBe(
			"disabled",
		);
	});

	it("calls no expense in 14 days, or never, dormant", () => {
		expect(
			userStatus(user({ lastExpenseDate: "2026-10-16" }), "2026-10-30"),
		).toBe("active");
		expect(
			userStatus(user({ lastExpenseDate: "2026-10-15" }), "2026-10-30"),
		).toBe("dormant");
		expect(userStatus(user({ lastExpenseDate: null }), "2026-10-30")).toBe(
			"dormant",
		);
	});
});

describe("small helpers", () => {
	it("builds the sign-up link without doubling the slash", () => {
		expect(inviteLink("https://r.test/", "AB 1")).toBe(
			"https://r.test/signup?code=AB%201",
		);
	});

	it("takes the first line of a message", () => {
		expect(firstLine("  one\ntwo ")).toBe("one");
		expect(firstLine("")).toBe("");
	});

	it("keeps the server's import limit in the choices", () => {
		expect(importJobChoices(3)).toContain(3);
		expect(importJobChoices(7)).toEqual([1, 2, 3, 4, 5, 7, 8, 10, 20, 50]);
	});
});

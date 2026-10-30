import type { AdminUser } from "./types";

/**
 * Whether this phone may open Admin. The server decides every call; this only
 * decides whether to offer the section. An admin whose session was made before
 * phones could hold the admin scope has the role but not the scope: the row
 * asks them to sign in again instead of failing on every page.
 */
export type AdminAccess = "none" | "signIn" | "ok";

export function adminAccess(
	me: { role: string; principal: { scopes: readonly string[] } } | null,
): AdminAccess {
	if (!me) return "none";
	if (me.role !== "ADMIN") return "none";
	return me.principal.scopes.includes("admin") ? "ok" : "signIn";
}

export type UserFilter = "all" | "admins" | "disabled" | "unverified";
export const USER_FILTERS: readonly UserFilter[] = [
	"all",
	"admins",
	"disabled",
	"unverified",
];

/** Search text matches the username or the email, any case; filters narrow first. */
export function filterUsers(
	users: readonly AdminUser[],
	filter: UserFilter,
	query: string,
): AdminUser[] {
	const text = query.trim().toLocaleLowerCase();
	return users.filter((user) => {
		if (filter === "admins" && user.role !== "ADMIN") return false;
		if (filter === "disabled" && user.isActive) return false;
		if (filter === "unverified" && user.emailVerified) return false;
		if (text === "") return true;
		return (
			(user.username ?? "").toLocaleLowerCase().includes(text) ||
			user.email.toLocaleLowerCase().includes(text)
		);
	});
}

export type UserStatus = "disabled" | "dormant" | "active";

/** The web's rule: no expense in 14 days is dormant. `today` is a day string (YYYY-MM-DD). */
export function userStatus(user: AdminUser, today: string): UserStatus {
	if (!user.isActive) return "disabled";
	if (!user.lastExpenseDate) return "dormant";
	const gap =
		(Date.parse(`${today}T00:00:00Z`) -
			Date.parse(`${user.lastExpenseDate}T00:00:00Z`)) /
		86_400_000;
	return gap > 14 ? "dormant" : "active";
}

/** Who a user is, for a row: the username, else the email. */
export function userLabel(user: AdminUser): string {
	return user.username && user.username !== "" ? user.username : user.email;
}

/** The sign-up link an invite code opens on the connected server. */
export function inviteLink(baseUrl: string, code: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/signup?code=${encodeURIComponent(code)}`;
}

/** The first line of a message, cut for a row. */
export function firstLine(text: string): string {
	return text.trim().split(/\r?\n/)[0] ?? "";
}

/** The max-import-jobs choices: a short ladder, plus the server's own value if it is off the ladder. */
export function importJobChoices(current: number): number[] {
	const ladder = [1, 2, 3, 4, 5, 8, 10, 20, 50];
	return ladder.includes(current)
		? ladder
		: [...ladder, current].sort((a, b) => a - b);
}

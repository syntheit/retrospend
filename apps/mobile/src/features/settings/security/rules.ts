import type { SignedInSessionDto } from "@retrospend/api-contract";

/** PASSWORD_MIN_LENGTH and PASSWORD_MAX_LENGTH of the contract (account/security.ts). */
const MIN_LENGTH = 8;
const MAX_LENGTH = 255;

/**
 * The new password rules the server holds (POST /me/password): 8 or more
 * characters, a lowercase and an uppercase letter, and a number. Shown as
 * checks while typing, as on the web.
 */
export type PasswordCheck = "length" | "case" | "number";

export const PASSWORD_CHECKS: PasswordCheck[] = ["length", "case", "number"];

export function passwordChecks(value: string): Record<PasswordCheck, boolean> {
	return {
		length: value.length >= MIN_LENGTH && value.length <= MAX_LENGTH,
		case: /[a-z]/.test(value) && /[A-Z]/.test(value),
		number: /\d/.test(value),
	};
}

/** The sheet can submit: current given, every rule met, both new fields match. */
export function passwordReady(input: {
	current: string;
	next: string;
	confirm: string;
}): boolean {
	return (
		input.current !== "" &&
		Object.values(passwordChecks(input.next)).every(Boolean) &&
		input.next === input.confirm
	);
}

/**
 * What a session is called in the list, as a catalog key and its values:
 * the device client by its id, the app and the web by what the user agent
 * says (browser and system), or plainly when it says nothing useful.
 */
export type SessionName =
	| { key: "cli" | "desktop" | "mcp" | "device" }
	| { key: "app"; system: string | null }
	| { key: "browser"; browser: string; system: string | null }
	| { key: "web"; system: string | null };

const CLIENTS: Record<string, "cli" | "desktop" | "mcp"> = {
	"retrospend-cli": "cli",
	"retrospend-desktop": "desktop",
	"retrospend-mcp": "mcp",
};

/** Order matters: Edge and Opera also say Chrome, Chrome also says Safari. */
const BROWSERS: [RegExp, string][] = [
	[/Edg(e|A|iOS)?\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/Firefox\/|FxiOS\//, "Firefox"],
	[/Chrome\/|CriOS\//, "Chrome"],
	[/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
	[/iPad/, "iPadOS"],
	[/iPhone|iOS|CFNetwork|Darwin.*iPhone/, "iOS"],
	[/Android|okhttp/i, "Android"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Windows/, "Windows"],
	[/CrOS/, "ChromeOS"],
	[/Linux|X11/, "Linux"],
];

function match(table: [RegExp, string][], text: string): string | null {
	return table.find(([re]) => re.test(text))?.[1] ?? null;
}

export function sessionName(
	session: Pick<SignedInSessionDto, "kind" | "clientId" | "userAgent">,
): SessionName {
	const ua = session.userAgent ?? "";
	const system = match(SYSTEMS, ua);
	if (session.kind === "device") {
		const client = session.clientId ? CLIENTS[session.clientId] : undefined;
		return { key: client ?? "device" };
	}
	if (session.kind === "mobile") return { key: "app", system };
	const browser = match(BROWSERS, ua);
	return browser ? { key: "browser", browser, system } : { key: "web", system };
}

/** The current session first, then the most recently used. */
export function orderSessions<
	T extends { current: boolean; lastUsedAt: string },
>(sessions: readonly T[]): T[] {
	return [...sessions].sort(
		(a, b) =>
			Number(b.current) - Number(a.current) ||
			b.lastUsedAt.localeCompare(a.lastUsedAt),
	);
}

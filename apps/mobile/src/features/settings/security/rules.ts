import type { SignedInSessionDto } from "@retrospend/api-contract";

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

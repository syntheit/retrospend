import type { RouterOutputs } from "~/trpc/react";

/** A signed-in device as deviceSession.list returns it (no token, ever). */
export type SignedInDevice = RouterOutputs["deviceSession"]["list"][number];

/**
 * What a device is called in the list, as a catalog key and its values: a
 * device client by its id, the app and the browser by what the user agent
 * says (browser and system), or plainly when it says nothing useful. The
 * same reading as the mobile app's session list.
 */
export type DeviceName =
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

export function deviceName(
	d: Pick<SignedInDevice, "kind" | "clientId" | "userAgent">,
): DeviceName {
	const ua = d.userAgent ?? "";
	const system = match(SYSTEMS, ua);
	if (d.kind === "device") {
		const client = d.clientId ? CLIENTS[d.clientId] : undefined;
		return { key: client ?? "device" };
	}
	if (d.kind === "mobile") return { key: "app", system };
	const browser = match(BROWSERS, ua);
	return browser ? { key: "browser", browser, system } : { key: "web", system };
}

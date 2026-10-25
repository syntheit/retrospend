/**
 * The one nav definition (IMPLEMENTATION §4): the sidebar, the phone-web
 * bottom bar and the command palette all read these lists, so a destination
 * is added, renamed or moved here and nowhere else. Labels are keys in the
 * `shell.nav` message namespace (the entry's id).
 */
import {
	ArrowDownLeft,
	ArrowRightLeft,
	ChartLine,
	ChartPie,
	Coins,
	FileUp,
	Folder,
	House,
	type LucideIcon,
	Plus,
	Receipt,
	Repeat,
	Settings,
	Users,
	Wallet,
} from "lucide-react";

export type DestinationId =
	| "home"
	| "activity"
	| "budget"
	| "people"
	| "projects"
	| "wealth";
export type ToolId = "import" | "currencies";
export type PlaceId = "settings" | "recurring" | "insights";
export type NavId = DestinationId | ToolId | PlaceId;

export type NavEntry<Id extends NavId = NavId> = {
	id: Id;
	icon: LucideIcon;
	href: string;
};

/** The six destinations of the sidebar, in order (PLAN §5). */
export const DESTINATIONS: readonly NavEntry<DestinationId>[] = [
	{ id: "home", icon: House, href: "/home" },
	{ id: "activity", icon: Receipt, href: "/activity" },
	{ id: "budget", icon: Wallet, href: "/budget" },
	{ id: "people", icon: Users, href: "/people" },
	{ id: "projects", icon: Folder, href: "/projects" },
	{ id: "wealth", icon: ChartLine, href: "/wealth" },
];

/** Phone tabs (N65): Wealth is reached from Home, so it has no tab. */
export const PHONE_TABS: readonly DestinationId[] = [
	"home",
	"activity",
	"budget",
	"people",
	"projects",
];

/** The sidebar's Tools group (N46, N48). */
export const TOOLS: readonly NavEntry<ToolId>[] = [
	{ id: "import", icon: FileUp, href: "/import" },
	{ id: "currencies", icon: Coins, href: "/currencies" },
];

/** Places with no nav item of their own; the palette's Go to reaches them (R28). */
export const PLACES: readonly NavEntry<PlaceId>[] = [
	{ id: "settings", icon: Settings, href: "/settings" },
	{ id: "recurring", icon: Repeat, href: "/activity/recurring" },
	{ id: "insights", icon: ChartPie, href: "/activity/insights" },
];

/**
 * Places without a phone tab, as Go to rows in the phone account sheet:
 * phones have no global search (N65), so everything else is reached here.
 */
export const PHONE_GO_TO: readonly NavId[] = [
	"wealth",
	"currencies",
	"import",
	"recurring",
	"insights",
	"settings",
];

/** The nav entry for an id. */
export function entryOf(id: NavId): NavEntry {
	const entry = [...DESTINATIONS, ...TOOLS, ...PLACES].find((e) => e.id === id);
	if (!entry) throw new Error(`No nav entry ${id}`);
	return entry;
}

/** Settings sections, by their anchor id on the Settings page. */
export const SETTINGS_SECTIONS = [
	"profile",
	"preferences",
	"categories",
	"payment",
	"notifications",
	"security",
	"data",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function settingsHref(section: SettingsSection): string {
	return `/settings#${section}`;
}

function under(pathname: string, route: string): boolean {
	return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * The sidebar or tab entry for a path: the longest matching route wins, so
 * /activity/recurring is Activity and not a shorter lookalike.
 */
export function currentNav(
	pathname: string,
	entries: readonly NavEntry[] = [...DESTINATIONS, ...TOOLS],
): NavId | null {
	let best: { id: NavId; length: number } | null = null;
	for (const entry of entries)
		if (
			under(pathname, entry.href) &&
			(!best || entry.href.length > best.length)
		)
			best = { id: entry.id, length: entry.href.length };
	return best?.id ?? null;
}

/** Needs you counts per destination (from 2E's needsYou(); absent until then). */
export type NavBadges = Partial<Record<DestinationId, number>>;

/** A badge shows a positive count only; 100 and up reads "99+". */
export function badgeText(count: number | undefined): string | null {
	if (!count || count <= 0) return null;
	return count > 99 ? "99+" : String(count);
}

/** A project as the pinned group needs it. */
export type PinnedSource = {
	id: string;
	name: string;
	imagePath: string | null;
	status: "ACTIVE" | "ARCHIVED";
};

export const PINNED_MAX = 5;

/**
 * Pinned projects. There is no pin yet (GAPS.md), so like the kit the group
 * shows active projects, most recently updated first (the server's order).
 */
export function pinnedProjects<P extends PinnedSource>(projects: P[]): P[] {
	return projects.filter((p) => p.status === "ACTIVE").slice(0, PINNED_MAX);
}

export function projectHref(id: string): string {
	return `/projects/${id}`;
}

export type AddId = "expense" | "income" | "transfer";

export type AddEntry = {
	id: AddId;
	icon: LucideIcon;
	/** The single-key shortcut (PLAN §14). */
	key: "n" | "i" | "t";
	/** False until the sheet exists (Add income and Transfer come in 4G). */
	ready: boolean;
};

/** The Add family: the split button, the palette, the floating Add and N / I / T. */
export const ADD_ACTIONS: readonly AddEntry[] = [
	{ id: "expense", icon: Plus, key: "n", ready: true },
	{ id: "income", icon: ArrowDownLeft, key: "i", ready: true },
	{ id: "transfer", icon: ArrowRightLeft, key: "t", ready: true },
];

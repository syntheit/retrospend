import { Settings, type LucideIcon } from "lucide-react";
import {
	DESTINATIONS,
	hrefOf,
	PLACES,
	SETTINGS_SECTIONS,
	type SettingsSection,
	settingsHref,
	TOOLS,
} from "~/lib/nav";

/** A Go to row: a place, its icon and where it links. */
export type GoToItem = {
	id: string;
	icon: LucideIcon;
	href: string;
	/** Message key in the shell namespace, and the section for "Settings: X". */
	label: { key: string; section?: SettingsSection };
};

/**
 * Go to (RC14): the destinations, the tools, Settings and the pages that
 * moved under a destination, from the one nav definition. Settings sections
 * join once the person types, so the empty palette stays short.
 */
export function goToItems(typed: boolean): GoToItem[] {
	const places = [...DESTINATIONS, ...TOOLS, ...PLACES].flatMap((entry) => {
		const href = hrefOf(entry);
		return href
			? [
					{
						id: entry.id,
						icon: entry.icon,
						href,
						label: { key: `nav.${entry.id}` },
					},
				]
			: [];
	});
	if (!typed) return places;
	const sections = SETTINGS_SECTIONS.map((section) => ({
		id: `settings-${section}`,
		icon: Settings,
		href: settingsHref(section),
		label: { key: "palette.settingsSection", section },
	}));
	return [...places, ...sections];
}

export const RECENT_EXPENSES = 3;
export const RECENT_PROJECTS = 2;

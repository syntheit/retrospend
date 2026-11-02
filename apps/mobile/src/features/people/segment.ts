import Storage from "expo-sqlite/kv-store";

/** The two halves of the People tab on phones. */
export type PeopleSegment = "people" | "projects";

const KEY = "ui.people.segment";

export function parseSegment(value: unknown): PeopleSegment | null {
	return value === "people" || value === "projects" ? value : null;
}

/** The last segment the person chose; People when none was saved. */
export function readSegment(): PeopleSegment {
	try {
		return parseSegment(Storage.getItemSync(KEY)) ?? "people";
	} catch {
		return "people";
	}
}

export function writeSegment(segment: PeopleSegment): void {
	try {
		Storage.setItemSync(KEY, segment);
	} catch {
		// The choice is a convenience; the screen works without it.
	}
}

/**
 * The height of the People and Projects tab row on an Android phone, pinned
 * under the large bar (the row's 44 point tabs, their hairline and 8 of air
 * above the lists): the tab stack gives it to the bar's provider, PeopleHub
 * draws the row at that height.
 */
export function peopleTabsHeight(theme: {
	size: { touchMin: { phone: number } };
	space: Record<number, number>;
}): number {
	return theme.size.touchMin.phone + 1 + (theme.space[2] ?? 0);
}

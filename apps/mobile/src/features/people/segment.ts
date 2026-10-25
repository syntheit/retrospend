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

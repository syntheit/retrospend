import type { ProjectPage } from "./source";

// The two switches of a project's settings: whether new shares count without
// a review (the project's), and whether the project stays out of your own
// insights (yours alone). Name, note, currency and budget are Edit project's.

export interface SettingsForm {
	autoAccept: boolean;
	exclude: boolean;
}

export function settingsOf(
	page: Pick<ProjectPage, "autoAcceptSplits" | "excludeFromAnalytics">,
): SettingsForm {
	return {
		autoAccept: page.autoAcceptSplits,
		exclude: page.excludeFromAnalytics,
	};
}

/** What differs from `before`; a key is left out when its switch did not move. */
export function settingsChange(
	before: SettingsForm,
	next: SettingsForm,
): Partial<SettingsForm> {
	return {
		...(next.autoAccept !== before.autoAccept
			? { autoAccept: next.autoAccept }
			: {}),
		...(next.exclude !== before.exclude ? { exclude: next.exclude } : {}),
	};
}

export function settingsChanged(before: SettingsForm, next: SettingsForm) {
	return Object.keys(settingsChange(before, next)).length > 0;
}

/** Whether the join and leave dates of a member can be opened at all. */
export function showsMembers(page: Pick<ProjectPage, "solo">): boolean {
	return !page.solo;
}

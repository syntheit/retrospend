import { Platform } from "react-native";

/**
 * Projects is its own destination only on iPad, whose sidebar lists all six.
 * Phones (iPhone and Android, tablets included) have four destinations and
 * the add control, so Projects is the second segment of the People tab.
 */
export const PROJECTS_APART = Platform.OS === "ios" && Platform.isPad;

/** Where a project opens: its own tab on iPad, inside People elsewhere. */
export function projectRoute(id: string) {
	return PROJECTS_APART
		? ({ pathname: "/projects/[id]", params: { id } } as const)
		: ({ pathname: "/people/project/[id]", params: { id } } as const);
}

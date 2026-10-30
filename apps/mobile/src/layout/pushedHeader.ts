/**
 * The header of a screen pushed over another (Settings and its pages). It is
 * the system's: on iOS the chevron with the previous title or "Back", on
 * Android the Material 3 up arrow. It never hides the header or the back
 * affordance; `headerBackVisible` stays at its default, so a screen with
 * something to go back to always shows it. Android gets a flat bar on the
 * theme background; on iOS an opaque `headerStyle` would paint over the large
 * title, so it is left to the system material.
 */
export function pushedHeader(
	color: { bg: string; fg: string },
	android: boolean,
) {
	return {
		headerShown: true,
		headerShadowVisible: false,
		headerTintColor: color.fg,
		headerStyle: android ? { backgroundColor: color.bg } : undefined,
		contentStyle: { backgroundColor: color.bg },
	} as const;
}

/**
 * The pages under Settings, by route name in the root stack. They sit in the
 * root stack, not in a stack of their own: the first screen of a nested stack
 * has nothing to go back to inside it, so the system draws no back button
 * there, and a link straight to a page (Currencies from the account sheet)
 * would have none either. In the root stack every one of them goes back to
 * wherever it was opened from. `title` is a key under `mobile.settings`; a
 * page without one sets its own title, and a `redirect` page leaves at once
 * and shows no header.
 */
export const SETTINGS_SCREENS: readonly {
	name: string;
	title?: string;
	large?: true;
	redirect?: true;
}[] = [
	{ name: "settings/index", title: "title", large: true },
	{ name: "settings/profile", title: "profile.title" },
	{ name: "settings/preferences", title: "root.preferences" },
	{ name: "settings/categories", title: "manage.categories" },
	{ name: "settings/payment-methods", title: "manage.payment" },
	{ name: "settings/notifications", title: "root.notifications" },
	{ name: "settings/security", title: "security.title" },
	{ name: "settings/sessions", title: "security.sessions.title" },
	{ name: "settings/data", title: "data.title" },
	{ name: "settings/danger", title: "root.danger" },
	{ name: "settings/currencies" },
	{ name: "settings/recurring", redirect: true },
];

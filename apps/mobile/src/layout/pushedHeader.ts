import { light } from "@retrospend/tokens/theme";

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
 * The options of the tabs screen in the root stack. It draws no header, but
 * the system labels the back button of a screen pushed over it with this
 * screen's title, and with none it falls back to the route name, "(tabs)".
 * The title is the word Back, so a page pushed from a tab reads "< Back".
 */
export function tabsScreenOptions(back: string) {
	return { title: back } as const;
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
	/** The catalog the title comes from: mobile.settings unless "admin". */
	ns?: "admin";
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
	{ name: "settings/admin", title: "title", ns: "admin" },
	{ name: "settings/admin-users", title: "users.title", ns: "admin" },
	{ name: "settings/invite-codes", title: "invites.title", ns: "admin" },
	{ name: "settings/admin-invites", title: "invites.title", ns: "admin" },
	{ name: "settings/admin-feedback", title: "feedback.title", ns: "admin" },
	{ name: "settings/admin-settings", title: "settings.title", ns: "admin" },
];

/**
 * The Material 3 modal bottom sheet's shape on Android: 28 dp top corners and
 * a top margin of 72 dp (status bar included) that leaves the scrim showing
 * above the sheet at its large detent. Both come from the tokens
 * (`radius.sheet`, `size.sheetTop`).
 */
export const M3_SHEET_RADIUS = light.radius.sheet;
export const M3_SHEET_TOP_MARGIN = light.size.sheetTop.phone;

/**
 * The account sheet in the root stack: a native form sheet (the profile icon
 * opens it) with a stack of its own, so the places it lists push inside it
 * with the system back chevron and the sheet never changes height. One
 * detent, large, like the sheet it replaced. The sheet's own stack draws the
 * headers, so the root draws none. On Android it is a Material 3 modal bottom
 * sheet: the large detent stops 72 dp below the top (the scrim shows above
 * it), 28 dp top corners, dragged down or tapped out to close. The drag
 * handle is drawn by the sheet's layout (app/account/_layout.tsx).
 */
export function accountSheetOptions(
	windowHeight: number,
	topInset: number,
	android: boolean,
	background: string,
) {
	// The sheet's stack starts under the status bar and the detent is a share
	// of that, so the 72 dp margin is measured from the top of the screen.
	const stack = windowHeight - topInset;
	const large = android
		? Math.min(1, Math.max(0.5, 1 - (M3_SHEET_TOP_MARGIN - topInset) / stack))
		: 1;
	return {
		presentation: "formSheet" as const,
		headerShown: false,
		sheetAllowedDetents: [large],
		sheetGrabberVisible: true,
		...(android
			? {
					sheetCornerRadius: M3_SHEET_RADIUS,
					// The sheet's container: the shape the corners are cut from takes
					// this color (the page color, so the cards in it read as cards).
					contentStyle: { backgroundColor: background },
				}
			: {}),
	};
}

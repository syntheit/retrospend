import { router, useNavigation, usePathname } from "expo-router";

/**
 * The pages of Settings open in two places: pushed over the tabs
 * (`/settings/...`, from Home's rows and links) and inside the account sheet
 * (`/account/...`, from the profile icon). A page opened in the sheet keeps
 * going inside it, so the back chevron always returns to where the person
 * came from (a screen opened from a sheet returns to that sheet).
 */
export type SettingsRoute =
	| "settings"
	| "profile"
	| "preferences"
	| "categories"
	| "payment-methods"
	| "notifications"
	| "security"
	| "sessions"
	| "data"
	| "danger"
	| "currencies"
	| "admin"
	| "admin-users"
	| "invite-codes"
	| "admin-invites"
	| "admin-feedback"
	| "admin-settings";

/** The route of a settings page, inside the account sheet or pushed over the tabs. */
export function settingsHref(page: SettingsRoute, inAccount: boolean): string {
	if (inAccount) return `/account/${page}`;
	return page === "settings" ? "/settings" : `/settings/${page}`;
}

export function isAccountPath(pathname: string): boolean {
	return pathname === "/account" || pathname.startsWith("/account/");
}

/** Opens a settings page next to the one it is called from. */
export function useOpenSettingsRoute(): (page: SettingsRoute) => void {
	const inAccount = isAccountPath(usePathname());
	return (page) => router.push(settingsHref(page, inAccount) as never);
}

/**
 * Closes the whole account sheet from any page inside it: the sheet is one
 * screen of the root stack, so going back from its parent pops the sheet
 * with everything pushed in it.
 */
export function useCloseAccountSheet(): () => void {
	const navigation = useNavigation();
	return () => (navigation.getParent() ?? navigation).goBack();
}

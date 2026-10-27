import { usePathname } from "expo-router";
import { Platform } from "react-native";

/**
 * Where Wealth lives. The iPad sidebar has its own Wealth destination (all six
 * destinations show there). iPhone and Android keep four tabs, so Wealth is
 * pushed onto the stack of the screen that links to it: Home (the net worth
 * line) or Budget (its last row). Each stack renders the same screens, so
 * Android back and the iOS swipe go back to where you came from.
 */
export type WealthBase = "/wealth" | "/home/wealth" | "/budget/wealth";

const IPAD = Platform.OS === "ios" && Platform.isPad;

/** Where Wealth opens from `origin`: its own tab on iPad, a pushed screen elsewhere. */
export function wealthHref(origin: "home" | "budget"): WealthBase {
	if (IPAD) return "/wealth";
	return origin === "home" ? "/home/wealth" : "/budget/wealth";
}

/** The Wealth root a screen is inside, read from its path ("/home/wealth/7"). */
export function wealthBaseOf(pathname: string): WealthBase {
	if (pathname.startsWith("/home/wealth")) return "/home/wealth";
	if (pathname.startsWith("/wealth")) return "/wealth";
	return "/budget/wealth";
}

/** An account opens in the stack that is showing Wealth, so back leaves it. */
export function accountHref(base: WealthBase, id: string): string {
	return `${base}/${id}`;
}

export function useAccountHref(): (id: string) => string {
	const base = wealthBaseOf(usePathname());
	return (id) => accountHref(base, id);
}

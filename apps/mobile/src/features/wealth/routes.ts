import { usePathname } from "expo-router";

/**
 * Where Wealth lives: its own tab on every phone and on the iPad sidebar, so
 * the Home net worth line and the Budget link both switch to it. An account
 * opens inside the Wealth stack, so back returns to the list.
 */
export type WealthBase = "/wealth";

/** Where Wealth opens from `origin` (Home or Budget): the tab. */
export function wealthHref(_origin: "home" | "budget"): WealthBase {
	return "/wealth";
}

/** The Wealth root a screen is inside. */
export function wealthBaseOf(_pathname: string): WealthBase {
	return "/wealth";
}

export function accountHref(base: WealthBase, id: string): string {
	return `${base}/${id}`;
}

export function useAccountHref(): (id: string) => string {
	const base = wealthBaseOf(usePathname());
	return (id) => accountHref(base, id);
}

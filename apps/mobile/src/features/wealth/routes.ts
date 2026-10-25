import { Platform } from "react-native";

/**
 * Where Wealth lives. The iPad sidebar has its own Wealth destination (all six
 * destinations show there); iPhone and Android keep five tabs, so Wealth is
 * pushed from Budget. Both stacks render the same screens.
 */
export function wealthHref(): "/wealth" | "/budget/wealth" {
	return Platform.OS === "ios" && Platform.isPad ? "/wealth" : "/budget/wealth";
}

export function accountHref(id: string): string {
	return `${wealthHref()}/${id}`;
}

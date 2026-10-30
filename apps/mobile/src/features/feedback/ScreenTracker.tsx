import { useSegments } from "expo-router";
import { useEffect } from "react";
import { setCurrentScreen } from "./runtime";

/**
 * Renders nothing. Keeps the current route for error reports and feedback as
 * its template (/(tabs)/activity/[id]), never the address with its ids, so a
 * name or id in a route parameter cannot leave the phone.
 */
export function ScreenTracker() {
	const route = `/${useSegments().join("/")}`;
	useEffect(() => {
		setCurrentScreen(route);
	}, [route]);
	return null;
}

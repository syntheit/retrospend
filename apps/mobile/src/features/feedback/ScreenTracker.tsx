import { usePathname } from "expo-router";
import { useEffect } from "react";
import { setCurrentScreen } from "./runtime";

/** Renders nothing. Keeps the current route for error reports and feedback. */
export function ScreenTracker() {
	const pathname = usePathname();
	useEffect(() => {
		setCurrentScreen(pathname);
	}, [pathname]);
	return null;
}

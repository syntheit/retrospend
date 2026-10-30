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

/** The pages a route can be, each with a name in `mobile.feedback.screens`. */
export type ScreenKey =
	| "home"
	| "insights"
	| "activity"
	| "entry"
	| "budget"
	| "currencies"
	| "people"
	| "person"
	| "project"
	| "projects"
	| "preferences"
	| "recurring"
	| "wealth"
	| "account"
	| "settings"
	| "profile"
	| "categories"
	| "paymentMethods"
	| "notifications"
	| "security"
	| "sessions"
	| "data"
	| "admin"
	| "signIn"
	| "connect"
	| "other";

const PAGES: Record<string, ScreenKey> = {
	"": "home",
	home: "home",
	"home/insights": "insights",
	insights: "insights",
	activity: "activity",
	"activity/[id]": "entry",
	budget: "budget",
	currencies: "currencies",
	"settings/currencies": "currencies",
	people: "people",
	"people/project/[id]": "project",
	"people/[type]/[id]": "person",
	projects: "projects",
	"projects/[id]": "project",
	preferences: "preferences",
	"settings/preferences": "preferences",
	recurring: "recurring",
	"settings/recurring": "recurring",
	wealth: "wealth",
	"wealth/[id]": "account",
	settings: "settings",
	"settings/danger": "settings",
	"settings/profile": "profile",
	"settings/categories": "categories",
	"settings/payment-methods": "paymentMethods",
	"settings/notifications": "notifications",
	"settings/security": "security",
	"settings/sessions": "sessions",
	"settings/data": "data",
	"settings/admin": "admin",
	"settings/admin-users": "admin",
	"settings/admin-invites": "admin",
	"settings/admin-feedback": "admin",
	"settings/admin-settings": "admin",
	"sign-in": "signIn",
	connect: "connect",
};

/**
 * Which page a route is, for the feedback preview: a name a person knows
 * ("Home") instead of the route template. Unknown routes are "other".
 */
export function screenKey(route: string | undefined): ScreenKey {
	const path = (route ?? "/")
		.split(/[?#]/)[0]
		?.split("/")
		.filter((part) => part !== "" && !/^\(.*\)$/.test(part))
		.join("/");
	return PAGES[path ?? ""] ?? "other";
}

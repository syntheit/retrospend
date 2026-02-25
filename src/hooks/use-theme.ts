"use client";

import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "auto";
export type Theme = "light" | "dark";

export function getResolvedTheme(pref: ThemePreference): Theme {
	if (pref !== "auto") return pref;

	const now = new Date();
	const hours = now.getHours();
	const minutes = now.getMinutes();
	const time = hours + minutes / 60;

	// Light mode between 5:00 AM (5) and 7:30 PM (19.5)
	if (time >= 5 && time < 19.5) {
		return "light";
	}
	return "dark";
}

export function getInitialTheme(): ThemePreference {
	if (typeof window === "undefined") return "dark";

	try {
		const stored = localStorage.getItem("theme-preference");
		if (stored === "light" || stored === "dark" || stored === "auto") {
			return stored as ThemePreference;
		}
		// Fallback for old "theme" key
		const old = localStorage.getItem("theme");
		if (old === "light" || old === "dark") {
			return old as ThemePreference;
		}
		return "dark";
	} catch (_) {
		return "dark";
	}
}

export function useTheme() {
	const [preference, setPreference] = useState<ThemePreference>("dark");
	const [theme, setTheme] = useState<Theme>("dark");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		const initialPref = getInitialTheme();
		setPreference(initialPref);
		setTheme(getResolvedTheme(initialPref));
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted) return;
		localStorage.setItem("theme-preference", preference);
		setTheme(getResolvedTheme(preference));
	}, [preference, mounted]);

	// Update theme every minute if on "auto"
	useEffect(() => {
		if (preference !== "auto" || !mounted) return;

		const interval = setInterval(() => {
			setTheme(getResolvedTheme("auto"));
		}, 60000);

		return () => clearInterval(interval);
	}, [preference, mounted]);

	return {
		theme,
		preference,
		setTheme: (t: ThemePreference) => setPreference(t),
		mounted,
	};
}

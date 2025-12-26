"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function getInitialTheme(): Theme {
	if (typeof window === "undefined") return "light";

	try {
		const stored = localStorage.getItem("theme");
		if (stored === "dark") {
			return "dark";
		}
		return "light";
	} catch (_) {
		return "light";
	}
}

export function useTheme() {
	const [theme, setTheme] = useState<Theme>("light");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		// After hydration, get the actual theme
		const actualTheme = getInitialTheme();
		setTheme(actualTheme);
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted) return;

		// Only save to localStorage after hydration
		localStorage.setItem("theme", theme);
	}, [theme, mounted]);

	const toggleTheme = () => {
		setTheme((prev) => (prev === "light" ? "dark" : "light"));
	};

	return {
		theme,
		toggleTheme,
		mounted,
	};
}

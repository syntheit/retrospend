"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function getInitialTheme(): Theme {
	if (typeof window === "undefined") return "dark";

	try {
		const stored = localStorage.getItem("theme");
		if (stored === "light" || stored === "dark") {
			return stored;
		}
		return "dark";
	} catch (_) {
		return "dark";
	}
}

export function useTheme() {
	const [theme, setTheme] = useState<Theme>("dark");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setTheme(getInitialTheme());
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted) return;
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

"use client";

import { createContext, useContext, useEffect } from "react";
import { useTheme } from "~/hooks/use-theme";

// Client-side script to apply theme immediately before React hydration
function ThemeScript() {
	return (
		<script
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Required for theme script before React hydration
			dangerouslySetInnerHTML={{
				__html: `
          try {
            const pref = localStorage.getItem("theme-preference") || localStorage.getItem("theme") || "dark";
            let theme = pref;
            if (pref === "auto") {
              const now = new Date();
              const time = now.getHours() + now.getMinutes() / 60;
              theme = (time >= 5 && time < 19.5) ? "light" : "dark";
            }
            if (theme === "dark") {
              document.documentElement.classList.add("dark");
            } else {
              document.documentElement.classList.remove("dark");
            }
          } catch (e) {
            document.documentElement.classList.add("dark");
          }
        `,
			}}
		/>
	);
}

const ThemeContext = createContext<ReturnType<typeof useTheme> | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const theme = useTheme();

	useEffect(() => {
		// Apply theme class to html element after hydration
		const root = document.documentElement;
		if (theme.theme === "dark") {
			root.classList.add("dark");
		} else {
			root.classList.remove("dark");
		}
	}, [theme.theme]);

	return (
		<ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
	);
}

export function useThemeContext() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useThemeContext must be used within a ThemeProvider");
	}
	return context;
}

export { ThemeScript };

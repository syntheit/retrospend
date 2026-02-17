"use client";

import { createContext, useContext, useEffect } from "react";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

const FontContext = createContext<{ fontPreference: "sans" | "mono" } | null>(
	null,
);

function getStoredFontPreference(): "sans" | "mono" {
	if (typeof window === "undefined") return "sans";

	try {
		return localStorage.getItem("fontPreference") === "mono" ? "mono" : "sans";
	} catch {
		return "sans";
	}
}

// Client-side script to apply font before React hydration
function FontScript() {
	return (
		<script
			// biome-ignore lint/security/noDangerouslySetInnerHtml: inline script runs before hydration
			dangerouslySetInnerHTML={{
				__html: `
          try {
            const stored = localStorage.getItem("fontPreference");
            const font = stored === "mono" ? "mono" : "sans";
            const root = document.documentElement;
            root.classList.remove("font-sans", "font-mono");
            root.classList.add(\`font-\${font}\`);
          } catch (e) {
            // keep default font on error
          }
        `,
			}}
		/>
	);
}

export function FontProvider({ children }: { children: React.ReactNode }) {
	const { data: session } = useSession();
	const { data: settings } = api.settings.getGeneral.useQuery(undefined, {
		enabled: !!session?.user,
	});

	useEffect(() => {
		const root = document.documentElement;

		// Priority: API settings > localStorage > default
		const fontPreference =
			settings?.fontPreference ?? getStoredFontPreference();

		root.classList.remove("font-sans", "font-mono");
		root.classList.add(`font-${fontPreference}`);

		// Only store if it's actually different from what's stored
		try {
			if (localStorage.getItem("fontPreference") !== fontPreference) {
				localStorage.setItem("fontPreference", fontPreference);
			}
		} catch {
			// ignore storage issues
		}
	}, [settings?.fontPreference]);

	// Listen for local changes to fontPreference (e.g. from the settings form)
	useEffect(() => {
		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === "fontPreference" && e.newValue) {
				const root = document.documentElement;
				root.classList.remove("font-sans", "font-mono");
				root.classList.add(`font-${e.newValue}`);
			}
		};
		window.addEventListener("storage", handleStorageChange);

		// Also poll or use a custom event for same-tab changes if needed,
		// but since we want to avoid complex state sync, we'll stick to a simple effect.
		return () => window.removeEventListener("storage", handleStorageChange);
	}, []);

	return (
		<FontContext.Provider
			value={{ fontPreference: settings?.fontPreference ?? "sans" }}
		>
			{children}
		</FontContext.Provider>
	);
}

export function useFontContext() {
	const context = useContext(FontContext);
	if (!context) {
		throw new Error("useFontContext must be used within a FontProvider");
	}
	return context;
}

export { FontScript };

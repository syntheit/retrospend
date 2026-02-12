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
		const storedPreference = getStoredFontPreference();
		const fontPreference = settings?.fontPreference ?? storedPreference;

		root.classList.remove("font-sans", "font-mono");
		root.classList.add(`font-${fontPreference}`);

		try {
			localStorage.setItem("fontPreference", fontPreference);
		} catch {
			// ignore storage issues to keep hydration safe
		}
	}, [settings?.fontPreference]);

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

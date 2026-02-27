"use client";

import { createContext, useContext } from "react";

const FontContext = createContext<{ fontPreference: "sans" | "mono" }>({
	fontPreference: "sans",
});

// Client-side script to apply font before React hydration
function FontScript() {
	return (
		<script
			// biome-ignore lint/security/noDangerouslySetInnerHtml: inline script runs before hydration
			dangerouslySetInnerHTML={{
				__html: `
          try {
            const root = document.documentElement;
            root.classList.remove("font-sans", "font-mono");
            root.classList.add("font-sans");
          } catch (e) {
            // keep default font on error
          }
        `,
			}}
		/>
	);
}

export function FontProvider({ children }: { children: React.ReactNode }) {
	return (
		<FontContext.Provider value={{ fontPreference: "sans" }}>
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

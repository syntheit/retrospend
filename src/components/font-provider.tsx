"use client";

import { createContext, useContext, useEffect } from "react";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

const FontContext = createContext<{ fontPreference: "sans" | "mono" } | null>(null);

export function FontProvider({ children }: { children: React.ReactNode }) {
	const { data: session } = useSession();
	const { data: settings } = api.user.getSettings.useQuery(undefined, {
		enabled: !!session?.user,
	});

	useEffect(() => {
		// Apply font preference class to html element after hydration
		const root = document.documentElement;
		const fontPreference = settings?.fontPreference ?? "sans";

		// Remove existing font classes
		root.classList.remove("font-sans", "font-mono");

		// Add the appropriate font class
		if (fontPreference === "mono") {
			root.classList.add("font-mono");
		} else {
			root.classList.add("font-sans");
		}
	}, [settings?.fontPreference]);

	return (
		<FontContext.Provider value={{ fontPreference: settings?.fontPreference ?? "sans" }}>
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

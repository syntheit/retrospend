import type { MetadataRoute } from "next";
import tokens from "@retrospend/tokens/tokens.json";

/**
 * The web app manifest that makes the site installable. There is no service
 * worker: installing gives a home screen icon and a window without browser
 * chrome, and the app still needs the network. A manifest holds one color, so
 * both come from the light theme's page background.
 */
export default function manifest(): MetadataRoute.Manifest {
	const background = tokens.light["color.bg"];
	return {
		name: "Retrospend",
		short_name: "Retrospend",
		description: "Expenses, budgets, and wealth tracking. Without the bloat.",
		id: "/home",
		start_url: "/home",
		scope: "/",
		display: "standalone",
		background_color: background,
		theme_color: background,
		icons: [
			{
				src: "/android-chrome-192x192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/android-chrome-512x512.png",
				sizes: "512x512",
				type: "image/png",
			},
		],
	};
}

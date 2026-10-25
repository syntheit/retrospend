// Hex equivalents of the light-mode oklch CSS variables
export const OG = {
	BG: "#f2efe9",
	CARD: "#fbfaf7",
	FG: "#3d3529",
	PRIMARY: "#6b5c4f",
	MUTED_FG: "#6e6660",
	BORDER: "#cec5b9",
	SECONDARY: "#ece0ca",
	WIDTH: 1200,
	HEIGHT: 630,
	RADIUS: 16,

	// Flat dark card: one background, no gradient, no decoration
	DARK_BG: "#1c1917",
	DARK_FG: "#fafaf9",
	DARK_MUTED: "#a8a29e",
	DARK_BORDER: "rgba(255,255,255,0.10)",
	DARK_SURFACE: "rgba(255,255,255,0.06)",
	/** The ring around an avatar on the dark card. */
	DARK_RING: "rgba(255,255,255,0.15)",
	WHITE: "#ffffff",
	WHITE_SOFT: "rgba(255,255,255,0.7)",
} as const;

// From user-avatar.tsx - WCAG AA 4.5:1 with white text
export const AVATAR_COLORS = [
	"#4338ca",
	"#6d28d9",
	"#be185d",
	"#be123c",
	"#c2410c",
	"#b45309",
	"#15803d",
	"#0e7490",
	"#1d4ed8",
	"#7e22ce",
];

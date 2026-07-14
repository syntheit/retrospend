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
	CARD_SHADOW: "0 2px 16px rgba(0,0,0,0.06)",
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

// Default gradient for project badges (Tailwind equivalents)
export const PROJECT_DEFAULT_GRADIENT: [string, string] = ["#6366f1", "#9333ea"];

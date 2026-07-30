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

	// Dark hero aesthetic — matches design system Hero Card Pattern
	DARK_BG_FROM: "#292524",   // stone-800
	DARK_BG_VIA: "#1c1917",   // stone-900
	DARK_BG_TO: "#0c0a09",    // stone-950
	DARK_FG: "#fafaf9",        // stone-50
	DARK_MUTED: "#a8a29e",     // stone-400
	DARK_BORDER: "rgba(255,255,255,0.10)",
	DARK_SURFACE: "rgba(255,255,255,0.06)",

	// Accent colors for CTAs and highlights
	EMERALD: "#10b981",        // emerald-500
	EMERALD_DIM: "rgba(16,185,129,0.15)",
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

export const CATEGORY_COLORS = [
	"emerald",
	"blue",
	"sky",
	"cyan",
	"teal",
	"orange",
	"amber",
	"violet",
	"pink",
	"fuchsia",
	"indigo",
	"slate",
	"zinc",
	"lime",
	"neutral",
	"gray",
	"purple",
	"yellow",
	"stone",
	"rose",
	"red",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export const BASE_CURRENCY = "USD";

export const CATEGORY_COLOR_MAP: Record<CategoryColor, string> = {
	emerald: "bg-emerald-600 text-white",
	blue: "bg-blue-600 text-white",
	sky: "bg-sky-500 text-white",
	cyan: "bg-cyan-600 text-white",
	teal: "bg-teal-600 text-white",
	orange: "bg-orange-500 text-white",
	amber: "bg-amber-500 text-white",
	violet: "bg-violet-600 text-white",
	pink: "bg-pink-600 text-white",
	fuchsia: "bg-fuchsia-500 text-white",
	indigo: "bg-indigo-600 text-white",
	slate: "bg-slate-700 text-white",
	zinc: "bg-zinc-600 text-white",
	lime: "bg-lime-500 text-white",
	neutral: "bg-neutral-600 text-white",
	gray: "bg-gray-600 text-white",
	purple: "bg-purple-600 text-white",
	yellow: "bg-yellow-400 text-stone-900",
	stone: "bg-stone-600 text-white",
	rose: "bg-rose-600 text-white",
	red: "bg-red-600 text-white",
};

export const VIBRANT_CATEGORY_COLORS: Record<string, string> = {
	emerald: "hsl(160, 84%, 39%)",
	blue: "hsl(217, 91%, 60%)",
	sky: "hsl(190, 84%, 50%)",
	cyan: "hsl(190, 84%, 50%)",
	teal: "hsl(160, 84%, 39%)",
	orange: "hsl(25, 95%, 53%)",
	amber: "hsl(38, 92%, 50%)",
	violet: "hsl(263, 70%, 50%)",
	pink: "hsl(0, 84%, 60%)",
	fuchsia: "hsl(263, 70%, 50%)",
	indigo: "hsl(217, 91%, 60%)",
	lime: "hsl(160, 84%, 39%)",
	purple: "hsl(263, 70%, 50%)",
	yellow: "hsl(38, 92%, 50%)",
	rose: "hsl(0, 84%, 60%)",
	red: "hsl(0, 84%, 60%)",
	slate: "#64748b",
	zinc: "#71717a",
	stone: "#78716c",
	gray: "#6b7280",
	neutral: "#737373",
};

export const COLOR_TO_HEX: Record<string, string> = {
	emerald: "#059669",
	blue: "#2563eb",
	sky: "#0ea5e9",
	cyan: "#0891b2",
	teal: "#0d9488",
	orange: "#ea580c",
	amber: "#f59e0b",
	violet: "#7c3aed",
	pink: "#ec4899",
	fuchsia: "#c026d3",
	indigo: "#4f46e5",
	slate: "#64748b",
	zinc: "#71717a",
	lime: "#65a30d",
	neutral: "#737373",
	gray: "#6b7280",
	purple: "#9333ea",
	yellow: "#eab308",
	stone: "#78716c",
	rose: "#f43f5e",
	red: "#dc2626",
};

export const DEFAULT_CATEGORIES = [
	{ name: "Groceries", color: "emerald" },
	{ name: "Restaurants", color: "orange" },
	{ name: "Cafe", color: "amber" },
	{ name: "Food Delivery", color: "rose" },
	{ name: "Drinks", color: "violet" },
	{ name: "Rent", color: "blue" },
	{ name: "Utilities", color: "sky" },
	{ name: "Health", color: "teal" },
	{ name: "Transport", color: "slate" },
	{ name: "Travel", color: "indigo" },
	{ name: "Electronics", color: "neutral" },
	{ name: "Subscriptions", color: "purple" },
	{ name: "Education", color: "yellow" },
	{ name: "Other", color: "gray" },
	{ name: "Fees", color: "red" },
	{ name: "Taxes", color: "slate" },
	{ name: "Social", color: "fuchsia" },
	{ name: "Date", color: "pink" },
	{ name: "Household", color: "stone" },
	{ name: "Hobby", color: "cyan" },
	{ name: "Gym", color: "lime" },
	{ name: "Clothing", color: "pink" },
	{ name: "Entertainment", color: "stone" },
	{ name: "Gifts", color: "amber" },
] as const;

const CATEGORY_COLOR_FALLBACK = {
	light: "bg-gray-500/10 text-gray-500",
	chip: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
	accent: "bg-gray-500/15 text-gray-500",
	accentSelected: "bg-gray-500/15 border-gray-500/40 text-gray-700 dark:text-gray-400",
} as const;

type CategoryColorVariant = keyof typeof CATEGORY_COLOR_FALLBACK;

export const CATEGORY_COLOR_VARIANTS: Record<
	CategoryColor,
	{ light: string; chip: string; accent: string; accentSelected: string }
> = {
	emerald: { light: "bg-emerald-500/10 text-emerald-500", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", accent: "bg-emerald-500/15 text-emerald-500", accentSelected: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
	blue: { light: "bg-blue-500/10 text-blue-500", chip: "bg-blue-500/10 text-blue-700 dark:text-blue-400", accent: "bg-blue-500/15 text-blue-500", accentSelected: "bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-400" },
	sky: { light: "bg-sky-500/10 text-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400", accent: "bg-sky-500/15 text-sky-500", accentSelected: "bg-sky-500/15 border-sky-500/40 text-sky-700 dark:text-sky-400" },
	cyan: { light: "bg-cyan-500/10 text-cyan-500", chip: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400", accent: "bg-cyan-500/15 text-cyan-500", accentSelected: "bg-cyan-500/15 border-cyan-500/40 text-cyan-700 dark:text-cyan-400" },
	teal: { light: "bg-teal-500/10 text-teal-500", chip: "bg-teal-500/10 text-teal-700 dark:text-teal-400", accent: "bg-teal-500/15 text-teal-500", accentSelected: "bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-400" },
	orange: { light: "bg-orange-500/10 text-orange-500", chip: "bg-orange-500/10 text-orange-700 dark:text-orange-400", accent: "bg-orange-500/15 text-orange-500", accentSelected: "bg-orange-500/15 border-orange-500/40 text-orange-700 dark:text-orange-400" },
	amber: { light: "bg-amber-500/10 text-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400", accent: "bg-amber-500/15 text-amber-500", accentSelected: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400" },
	violet: { light: "bg-violet-500/10 text-violet-500", chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400", accent: "bg-violet-500/15 text-violet-500", accentSelected: "bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-400" },
	pink: { light: "bg-pink-500/10 text-pink-500", chip: "bg-pink-500/10 text-pink-700 dark:text-pink-400", accent: "bg-pink-500/15 text-pink-500", accentSelected: "bg-pink-500/15 border-pink-500/40 text-pink-700 dark:text-pink-400" },
	fuchsia: { light: "bg-fuchsia-500/10 text-fuchsia-500", chip: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400", accent: "bg-fuchsia-500/15 text-fuchsia-500", accentSelected: "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-700 dark:text-fuchsia-400" },
	indigo: { light: "bg-indigo-500/10 text-indigo-500", chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400", accent: "bg-indigo-500/15 text-indigo-500", accentSelected: "bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-400" },
	slate: { light: "bg-slate-500/10 text-slate-500", chip: "bg-slate-500/10 text-slate-700 dark:text-slate-400", accent: "bg-slate-500/15 text-slate-500", accentSelected: "bg-slate-500/15 border-slate-500/40 text-slate-700 dark:text-slate-400" },
	zinc: { light: "bg-zinc-500/10 text-zinc-500", chip: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400", accent: "bg-zinc-500/15 text-zinc-500", accentSelected: "bg-zinc-500/15 border-zinc-500/40 text-zinc-700 dark:text-zinc-400" },
	lime: { light: "bg-lime-500/10 text-lime-500", chip: "bg-lime-500/10 text-lime-700 dark:text-lime-400", accent: "bg-lime-500/15 text-lime-500", accentSelected: "bg-lime-500/15 border-lime-500/40 text-lime-700 dark:text-lime-400" },
	neutral: { light: "bg-neutral-500/10 text-neutral-500", chip: "bg-neutral-500/10 text-neutral-700 dark:text-neutral-400", accent: "bg-neutral-500/15 text-neutral-500", accentSelected: "bg-neutral-500/15 border-neutral-500/40 text-neutral-700 dark:text-neutral-400" },
	gray: { light: "bg-gray-500/10 text-gray-500", chip: "bg-gray-500/10 text-gray-700 dark:text-gray-400", accent: "bg-gray-500/15 text-gray-500", accentSelected: "bg-gray-500/15 border-gray-500/40 text-gray-700 dark:text-gray-400" },
	purple: { light: "bg-purple-500/10 text-purple-500", chip: "bg-purple-500/10 text-purple-700 dark:text-purple-400", accent: "bg-purple-500/15 text-purple-500", accentSelected: "bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-400" },
	yellow: { light: "bg-yellow-500/10 text-yellow-500", chip: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400", accent: "bg-yellow-500/15 text-yellow-500", accentSelected: "bg-yellow-500/15 border-yellow-500/40 text-yellow-700 dark:text-yellow-400" },
	stone: { light: "bg-stone-500/10 text-stone-500", chip: "bg-stone-500/10 text-stone-700 dark:text-stone-400", accent: "bg-stone-500/15 text-stone-500", accentSelected: "bg-stone-500/15 border-stone-500/40 text-stone-700 dark:text-stone-400" },
	rose: { light: "bg-rose-500/10 text-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400", accent: "bg-rose-500/15 text-rose-500", accentSelected: "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-400" },
	red: { light: "bg-red-500/10 text-red-500", chip: "bg-red-500/10 text-red-700 dark:text-red-400", accent: "bg-red-500/15 text-red-500", accentSelected: "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400" },
};

export function getCategoryColorClasses(color: string, variant: CategoryColorVariant): string {
	return CATEGORY_COLOR_VARIANTS[color as CategoryColor]?.[variant] ?? CATEGORY_COLOR_FALLBACK[variant];
}

export const DEFAULT_PAGE_SIZE = 20;

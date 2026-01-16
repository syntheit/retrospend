import { CATEGORY_COLOR_MAP } from "./constants";

const colorClassCache = new Map<string, string>();

/**
 * Resolves a category color name to its computed CSS color value.
 * Uses DOM computation to get the actual RGB value from Tailwind classes.
 * Results are cached for performance.
 *
 * @param color - The category color name (e.g., "red", "blue")
 * @returns The computed CSS color value (e.g., "rgb(239, 68, 68)") or null
 */
export function resolveCategoryColorValue(color?: string): string | null {
	if (!color) return null;
	const colorClasses =
		CATEGORY_COLOR_MAP[color as keyof typeof CATEGORY_COLOR_MAP];
	const bgClass = colorClasses?.split(" ").find((cls) => cls.startsWith("bg-"));
	if (!bgClass) return null;

	if (colorClassCache.has(bgClass)) {
		return colorClassCache.get(bgClass) ?? null;
	}

	if (typeof window === "undefined" || typeof document === "undefined") {
		return null;
	}

	try {
		const el = document.createElement("div");
		el.className = bgClass;
		el.style.position = "absolute";
		el.style.left = "-9999px";
		el.style.width = "1px";
		el.style.height = "1px";
		document.body.appendChild(el);
		const computed = getComputedStyle(el).backgroundColor;
		document.body.removeChild(el);

		if (computed) {
			colorClassCache.set(bgClass, computed);
			return computed;
		}
	} catch {
		// DOM operation failed, return null gracefully
		return null;
	}

	return null;
}

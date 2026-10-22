import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design token names behind the Tailwind theme (src/styles/tokens.css).
 * tailwind-merge only knows the stock scale, so without these it reads
 * `text-small` as a color and drops it next to `text-fg-2`. A test compares
 * the lists with @retrospend/tokens, so a new token cannot be missed here.
 */
export const TOKEN_CLASS_NAMES = {
	text: ["hero", "title", "section", "body", "small", "meta"],
	radius: ["ctl", "panel", "chip"],
	shadow: ["menu", "ctl"],
	spacing: ["ctl", "ctl-sm", "row", "gutter", "trail", "money"],
	ease: ["land", "leave"],
} as const;

const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			text: [...TOKEN_CLASS_NAMES.text],
			radius: [...TOKEN_CLASS_NAMES.radius],
			shadow: [...TOKEN_CLASS_NAMES.shadow],
			spacing: [...TOKEN_CLASS_NAMES.spacing],
			ease: [...TOKEN_CLASS_NAMES.ease],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

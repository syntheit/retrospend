import {
	Bell,
	CreditCard,
	Download,
	KeyRound,
	type LucideIcon,
	ShieldCheck,
	SlidersHorizontal,
	Tags,
	TriangleAlert,
	User,
} from "lucide-react";

/**
 * The Settings sections in nav order (settings mockup, IMPLEMENTATION §1.1).
 * Each id is also its element id, so `/settings#<id>` (nav.ts settingsHref,
 * the palette) lands on it. Danger zone sits apart at the end of the nav.
 */
export const SECTIONS = [
	"profile",
	"preferences",
	"categories",
	"payment",
	"notifications",
	"security",
	"developer",
	"data",
	"danger",
] as const;

export type SectionId = (typeof SECTIONS)[number];

export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
	profile: User,
	preferences: SlidersHorizontal,
	categories: Tags,
	payment: CreditCard,
	notifications: Bell,
	security: ShieldCheck,
	developer: KeyRound,
	data: Download,
	danger: TriangleAlert,
};

export function isSectionId(value: string): value is SectionId {
	return (SECTIONS as readonly string[]).includes(value);
}

/** The section a URL hash names ("#security"), or null. */
export function sectionFromHash(hash: string): SectionId | null {
	const id = hash.replace(/^#/, "");
	return isSectionId(id) ? id : null;
}

/**
 * The section the scroll spy marks: the last one whose top has passed the
 * reading line, and the last section once the page is scrolled to the end
 * (a short last section never reaches the line).
 */
export function activeSection(
	tops: readonly { id: SectionId; top: number }[],
	line: number,
	atEnd: boolean,
): SectionId | null {
	if (tops.length === 0) return null;
	if (atEnd) return tops[tops.length - 1]?.id ?? null;
	let current: SectionId = tops[0]?.id ?? "profile";
	for (const s of tops) if (s.top <= line) current = s.id;
	return current;
}

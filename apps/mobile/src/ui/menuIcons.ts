import type { GlyphName } from "./Glyph";

/**
 * The glyphs a menu item may lead with, and the SF Symbol the iOS system menu
 * draws for each (it takes symbols, not drawings). Android draws the same
 * lucide glyph the rest of the app uses.
 */
export const MENU_SYMBOL = {
	Archive: "archivebox",
	ArchiveRestore: "arrow.uturn.backward",
	Download: "square.and.arrow.down",
	Pencil: "pencil",
	Repeat: "repeat",
	Settings: "gearshape",
	Share: "square.and.arrow.up",
	Trash2: "trash",
	UserPlus: "person.badge.plus",
} as const satisfies Partial<Record<GlyphName, string>>;

export type MenuIcon = keyof typeof MENU_SYMBOL;

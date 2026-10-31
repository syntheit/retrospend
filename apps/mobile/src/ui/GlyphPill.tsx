import { useTheme } from "@/theme";
import { Avatar, type Face } from "./Avatar";
import { Chip } from "./Chip";
import { CategoryGlyph, categoryColor, Glyph, type GlyphName } from "./Glyph";

/**
 * One choice in a panel of choices, with the mark of what it is: a category's
 * own glyph in its color, a plain glyph, or a person's face. The mark is bare
 * (no tinted tile; tiles belong to list rows). It is the Chip at its control
 * height with a 44 point hit area, on when picked (brand border, brand-soft
 * fill), so the state is a border and a fill, never a color alone.
 */
export function GlyphPill({
	label,
	selected,
	onPress,
	category,
	glyph,
	face,
	accessibilityLabel,
}: {
	label: string;
	selected: boolean;
	onPress: () => void;
	/** A category: its glyph (by its icon key or name) in its slot color. */
	category?: { name: string; icon: string | null; tone: number };
	/** A plain glyph in the secondary text color. */
	glyph?: GlyphName;
	/** A person. */
	face?: Face;
	accessibilityLabel?: string;
}) {
	const { color, size } = useTheme();
	const leading = category ? (
		<CategoryGlyph
			category={category}
			color={categoryColor(color, category.tone)}
			size={size.icon.phone}
		/>
	) : glyph ? (
		<Glyph color={color.fg2} name={glyph} size={size.icon.phone} />
	) : face ? (
		<Avatar face={face} size="xs" />
	) : undefined;
	return (
		<Chip
			accessibilityLabel={accessibilityLabel}
			label={label}
			leading={leading}
			onPress={onPress}
			selected={selected}
		/>
	);
}

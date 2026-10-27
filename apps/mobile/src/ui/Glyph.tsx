import {
	type CategoryIconName,
	categoryIconName,
} from "@retrospend/domain/category-icons";
import Svg, {
	Circle,
	Ellipse,
	Line,
	Path,
	Polygon,
	Polyline,
	Rect,
} from "react-native-svg";
import { type Theme, useTheme } from "@/theme";
import { GLYPHS } from "./glyphs.generated";

const SHAPES = {
	circle: Circle,
	ellipse: Ellipse,
	line: Line,
	path: Path,
	polygon: Polygon,
	polyline: Polyline,
	rect: Rect,
} as const;

/** Glyphs the screens use beyond the category icons. */
export type GlyphName = CategoryIconName | "Check" | "Coins" | "Search" | "X";

/**
 * One lucide glyph, the same drawings the web uses (GUIDELINE 2.7): 24 point
 * grid, the icon stroke token, round caps. Decorative: the row it sits in
 * carries the words, so a screen reader skips it.
 */
export function Glyph({
	name,
	size,
	color,
}: {
	name: GlyphName;
	size: number;
	color: string;
}) {
	const { size: sizes } = useTheme();
	return (
		<Svg
			accessibilityElementsHidden
			fill="none"
			height={size}
			importantForAccessibility="no-hide-descendants"
			stroke={color}
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={sizes.icon.stroke}
			viewBox="0 0 24 24"
			width={size}
		>
			{(GLYPHS[name] ?? GLYPHS.Tag ?? []).map(([tag, attrs], index) => {
				const Shape = SHAPES[tag as keyof typeof SHAPES];
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing never reorders
				return Shape ? <Shape key={index} {...attrs} /> : null;
			})}
		</Svg>
	);
}

/** A category's own glyph, bare: for pickers and menus, where a tinted tile is not allowed. */
export function CategoryGlyph({
	category,
	size,
	color,
}: {
	category: { name: string; icon?: string | null };
	size: number;
	color: string;
}) {
	return (
		<Glyph
			color={color}
			name={categoryIconName(category.name, category.icon)}
			size={size}
		/>
	);
}

/** The color of a category's slot (1 to 21); grey when the slot is unknown. */
export function categoryColor(color: Theme["color"], tone: number): string {
	const palette = color as unknown as Record<string, string>;
	return palette[`category${((tone - 1) % 21) + 1}`] ?? color.fg3;
}

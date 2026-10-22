"use client";

import type { CSSProperties } from "react";
import { useCategoryName } from "~/hooks/use-category-name";
import { Badge, type BadgeProps } from "~/components/ui/badge";
import { CATEGORY_COLOR_MAP, type CategoryColor } from "~/lib/constants";
import { getCategoryIcon } from "~/lib/category-icons";
import { cn } from "~/lib/utils";

interface CategoryBadgeProps extends Omit<BadgeProps, "color"> {
	name: string;
	color: string;
}

/** A category as a row shows it: its name, icon key and color slot (1 to 21). */
export type CategoryTileRef = { name: string; icon?: string | null; tone: number };

/**
 * CategoryTile: category identity in a list or table row, the tinted tile
 * with its glyph in the category color (R25 amended by R31: rows only;
 * menus and pickers show the bare glyph, chips no icon).
 */
export function CategoryTile({
	category,
	size = "default",
}: {
	category: CategoryTileRef;
	size?: "default" | "sm";
}) {
	const Icon = getCategoryIcon(category.name, category.icon);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"rounded-ctl inline-flex shrink-0 items-center justify-center bg-[color-mix(in_oklab,var(--c)_15%,var(--surface))] text-(--c)",
				size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
			)}
			style={{ "--c": `var(--category-${category.tone})` } as CSSProperties}
		>
			<Icon strokeWidth={1.75} />
		</span>
	);
}

export function CategoryBadge({
	name,
	color,
	className,
	...props
}: CategoryBadgeProps) {
	const { displayName } = useCategoryName();
	const colorClasses =
		CATEGORY_COLOR_MAP[color as CategoryColor] ||
		"bg-secondary text-secondary-foreground";

	return (
		<Badge
			className={cn(
				"border-transparent hover:opacity-90",
				colorClasses,
				className,
			)}
			variant="outline"
			{...props}
		>
			{displayName(name)}
		</Badge>
	);
}

import { Badge, type BadgeProps } from "~/components/ui/badge";
import { CATEGORY_COLOR_MAP, type CategoryColor } from "~/lib/constants";
import { cn } from "~/lib/utils";

interface CategoryBadgeProps extends Omit<BadgeProps, "color"> {
	name: string;
	color: string;
}

export function CategoryBadge({
	name,
	color,
	className,
	...props
}: CategoryBadgeProps) {
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
			{name}
		</Badge>
	);
}

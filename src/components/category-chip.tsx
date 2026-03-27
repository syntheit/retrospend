import { getCategoryIcon } from "~/lib/category-icons";
import { getCategoryColorClasses } from "~/lib/constants";
import { cn } from "~/lib/utils";

interface CategoryChipProps {
	name: string;
	color: string;
	icon?: string | null;
	className?: string;
}

export function CategoryChip({ name, color, icon, className }: CategoryChipProps) {
	const Icon = getCategoryIcon(name, icon);
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
				getCategoryColorClasses(color, "chip"),
				className,
			)}
		>
			<Icon className="h-3 w-3 shrink-0" />
			{name}
		</span>
	);
}

export function NoCategoryLabel() {
	return <div className="text-muted-foreground text-sm">No category</div>;
}

"use client";

import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn } from "~/lib/utils";

export interface CategorySegment {
	key: string;
	name: string;
	value: number;
	color: string | undefined;
	categoryColor: string | undefined;
	categoryId: string | undefined;
}

interface CategoryDonutLegendProps {
	data: CategorySegment[];
	hiddenCategories: Set<string>;
	categoryClickBehavior: string;
	formatMoney: (value: number) => string;
	onCategoryClick: (segment: CategorySegment) => void;
}

export function CategoryDonutLegend({
	data,
	hiddenCategories,
	categoryClickBehavior,
	formatMoney,
	onCategoryClick,
}: CategoryDonutLegendProps) {
	return (
		<div className="mt-4 grid gap-2 sm:grid-cols-2">
			{data.map((segment) => {
				const dotClass = segment.categoryColor
					? CATEGORY_COLOR_MAP[
							segment.categoryColor as keyof typeof CATEGORY_COLOR_MAP
						]?.split(" ")[0]
					: "bg-muted-foreground";
				const isHidden =
					segment.categoryId && hiddenCategories.has(segment.categoryId);

				return (
					<button
						className={cn(
							"group flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left transition-all",
							isHidden
								? "bg-muted/20 opacity-60 hover:bg-muted/30"
								: "bg-muted/30 hover:bg-muted/50",
						)}
						key={segment.key}
						{...(categoryClickBehavior === "toggle" && !!segment.categoryId
							? {
									"aria-pressed": Boolean(isHidden),
								}
							: {})}
						onClick={() => onCategoryClick(segment)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onCategoryClick(segment);
							}
						}}
						type="button"
					>
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"h-3 w-3 rounded-full",
									dotClass,
									isHidden && "opacity-50",
								)}
							/>
							<span
								className={cn(
									"text-sm transition-all",
									isHidden
										? "line-through opacity-70"
										: "group-hover:underline",
								)}
							>
								{segment.name}
							</span>
						</div>
						<span
							className={cn("font-semibold text-sm", isHidden && "opacity-70")}
						>
							{formatMoney(segment.value)}
						</span>
					</button>
				);
			})}
		</div>
	);
}

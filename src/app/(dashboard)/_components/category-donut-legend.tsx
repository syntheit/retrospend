"use client";

import { getCategoryIcon } from "~/lib/category-icons";
import { cn } from "~/lib/utils";

export interface CategorySegment {
	key: string;
	name: string;
	value: number;
	color: string | undefined;
	categoryColor: string | undefined;
	categoryId: string | undefined;
	icon?: string | null;
}

interface CategoryDonutLegendProps {
	data: CategorySegment[];
	hiddenCategories: Set<string>;
	categoryClickBehavior: string;
	formatMoney: (value: number) => string;
	onCategoryClick: (segment: CategorySegment) => void;
	onMouseEnter: (segment: CategorySegment, index: number) => void;
	onMouseLeave: () => void;
}

export function CategoryDonutLegend({
	data,
	hiddenCategories,
	categoryClickBehavior,
	formatMoney,
	onCategoryClick,
	onMouseEnter,
	onMouseLeave,
}: CategoryDonutLegendProps) {
	return (
		<div className="mt-4 grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-1 lg:gap-2">
			{data.map((segment) => {
				const isHidden =
					segment.categoryId && hiddenCategories.has(segment.categoryId);
				const Icon = getCategoryIcon(segment.name, segment.icon);

				return (
					<button
						className={cn(
							"group flex w-full cursor-pointer items-center justify-between gap-2 py-1.5 text-left transition-all",
							isHidden ? "opacity-40" : "opacity-100 hover:opacity-80",
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
						onMouseEnter={() => onMouseEnter(segment, data.indexOf(segment))}
						onMouseLeave={onMouseLeave}
						type="button"
					>
						<div className="flex min-w-0 items-center gap-2">
							<div
								className="relative flex shrink-0 items-center justify-center rounded-md"
								style={{ width: 22, height: 22 }}
							>
								<div
									className="absolute inset-0 rounded-md"
									style={{ backgroundColor: segment.color, opacity: 0.18 }}
								/>
								<Icon
									className={cn("relative", isHidden && "opacity-50")}
									size={13}
									strokeWidth={2}
									style={{ color: segment.color }}
								/>
							</div>
							<span
								className={cn(
									"truncate font-medium text-muted-foreground text-xs transition-all",
									isHidden ? "line-through" : "group-hover:text-foreground",
								)}
							>
								{segment.name}
							</span>
						</div>
						<span
							className={cn(
								"shrink-0 font-medium text-sm tabular-nums",
								isHidden ? "opacity-70" : "text-foreground",
							)}
						>
							{formatMoney(segment.value)}
						</span>
					</button>
				);
			})}
		</div>
	);
}

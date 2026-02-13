"use client";

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
		<div className="mt-4 grid gap-1">
			{data.map((segment) => {
				const isHidden =
					segment.categoryId && hiddenCategories.has(segment.categoryId);

				return (
					<button
						className={cn(
							"group flex w-full cursor-pointer items-center justify-between py-1.5 text-left transition-all",
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
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"h-2 w-2 rounded-full",
									isHidden && "opacity-50",
								)}
								style={{
									backgroundColor: segment.color,
								}}
							/>
							<span
								className={cn(
									"text-muted-foreground text-xs font-medium transition-all",
									isHidden ? "line-through" : "group-hover:text-foreground",
								)}
							>
								{segment.name}
							</span>
						</div>
						<span
							className={cn(
								"font-mono text-sm tabular-nums",
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

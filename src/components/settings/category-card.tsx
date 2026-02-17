"use client";

import * as LucideIcons from "lucide-react";
import { createElement } from "react";
import { getCategoryIcon } from "~/lib/category-icons";
import type { CategoryColor } from "~/lib/constants";
import { cn } from "~/lib/utils";

interface CategoryCardProps {
	id: string;
	name: string;
	color: CategoryColor;
	icon?: string | null;
	onClick: () => void;
}

export function CategoryCard({
	name,
	color,
	icon,
	onClick,
}: CategoryCardProps) {
	// Use utility to get smart icon if none is provided
	const IconComponent = getCategoryIcon(name, icon);

	return (
		<button
			className={cn(
				"group flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl transition-all",
				"border border-transparent bg-transparent shadow-none",
				"hover:border-border/50 hover:bg-secondary/20",
				"p-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary active:ring-1 active:ring-primary",
			)}
			onClick={onClick}
			type="button"
		>
			<div
				className={cn(
					"flex h-12 w-12 items-center justify-center rounded-full transition-transform group-hover:scale-110",
					// Relying on dynamic classes as requested
					`bg-${color}-500/10 text-${color}-500`,
				)}
			>
				{createElement(IconComponent, { className: "h-6 w-6" })}
			</div>
			<span className="line-clamp-2 text-center font-medium text-sm">
				{name}
			</span>
		</button>
	);
}

export function AddCategoryCard({ onClick }: { onClick: () => void }) {
	return (
		<button
			className={cn(
				"flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl transition-all",
				"border-2 border-muted border-dashed bg-transparent p-4",
				"hover:border-muted-foreground/30 hover:bg-secondary/10",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
			)}
			onClick={onClick}
			type="button"
		>
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/20 text-muted-foreground">
				<LucideIcons.Plus className="h-6 w-6" />
			</div>
			<span className="font-medium text-muted-foreground text-sm">Add New</span>
		</button>
	);
}

"use client";

import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { Eye, EyeOff, GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import type {
	LayoutItem,
	WidgetDefinition,
	WidgetSize,
} from "../_lib/widget-registry";

const SIZE_ORDER: Record<WidgetSize, number> = { xs: 0, sm: 1, md: 2, lg: 3 };
const ALL_SIZES: Array<{ value: WidgetSize; label: string }> = [
	{ value: "xs", label: "XS" },
	{ value: "sm", label: "S" },
	{ value: "md", label: "M" },
	{ value: "lg", label: "L" },
];

interface WidgetCardProps {
	definition: WidgetDefinition;
	item: LayoutItem;
	isEditMode: boolean;
	isDragging?: boolean;
	dragHandleProps?: {
		attributes: DraggableAttributes;
		listeners: SyntheticListenerMap | undefined;
	};
	onSizeChange?: (size: WidgetSize) => void;
	onToggleVisibility?: () => void;
	children: React.ReactNode;
}

export function WidgetCard({
	definition,
	item,
	isEditMode,
	isDragging,
	dragHandleProps,
	onSizeChange,
	onToggleVisibility,
	children,
}: WidgetCardProps) {
	const t = useTranslations("dashboard");
	const Icon = definition.icon;

	// These widgets already render their own Card chrome
	const isRawWidget =
		definition.id === "budget-pacing" ||
		definition.id === "recent-activity" ||
		definition.id === "category-breakdown" ||
		definition.id === "currency-watchlist";

	return (
		<div className="flex h-full flex-col">
			{isEditMode && (
				<div className="mb-1.5 flex shrink-0 items-center gap-2">
					<button
						className="flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
						type="button"
						{...dragHandleProps?.attributes}
						{...dragHandleProps?.listeners}
					>
						<GripVertical className="h-4 w-4" />
						<Icon className="h-3.5 w-3.5" />
						<span className="font-medium text-xs">
							{t(definition.name)}
						</span>
					</button>
					<div className="flex-1" />
					<ToggleGroup
						onValueChange={(val) => {
							if (val) onSizeChange?.(val as WidgetSize);
						}}
						size="sm"
						type="single"
						value={item.size}
					>
						{ALL_SIZES.filter(
							(s) => SIZE_ORDER[s.value] >= SIZE_ORDER[definition.minSize],
						).map((s) => (
							<ToggleGroupItem
								className="h-6 cursor-pointer px-2 text-[10px]"
								key={s.value}
								value={s.value}
							>
								{s.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<Button
						className="h-6 w-6 cursor-pointer"
						onClick={onToggleVisibility}
						size="icon"
						variant="ghost"
					>
						{item.visible ? (
							<EyeOff className="h-3.5 w-3.5" />
						) : (
							<Eye className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			)}

			{isRawWidget ? (
				<div
					className={cn(
						"flex-1",
						isEditMode && "rounded-lg ring-1 ring-border/50",
					)}
				>
					{children}
				</div>
			) : (
				<Card
					className={cn(
						"flex-1 border border-border bg-card shadow-sm",
						isEditMode && "ring-1 ring-border/50",
					)}
				>
					<CardHeader className="px-4 pb-2 sm:px-6">
						<CardTitle className="flex items-center gap-2 font-semibold text-lg tracking-tight">
							{t(definition.name)}
						</CardTitle>
					</CardHeader>
					<CardContent className="px-4 sm:px-6">
						{children}
					</CardContent>
				</Card>
			)}
		</div>
	);
}

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { WidgetSize } from "../_lib/widget-registry";

const SIZE_COL_SPAN: Record<WidgetSize, string> = {
	xs: "col-span-12 md:col-span-6 lg:col-span-3",
	sm: "col-span-12 md:col-span-4",
	md: "col-span-12 lg:col-span-6",
	lg: "col-span-12",
};

interface SortableWidgetProps {
	id: string;
	size: WidgetSize;
	isEditMode: boolean;
	children: (props: {
		isDragging: boolean;
		dragHandleProps: {
			attributes: ReturnType<typeof useSortable>["attributes"];
			listeners: ReturnType<typeof useSortable>["listeners"];
		};
	}) => ReactNode;
}

export function SortableWidget({
	id,
	size,
	isEditMode,
	children,
}: SortableWidgetProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id,
		disabled: !isEditMode,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			className={cn(
				SIZE_COL_SPAN[size],
				"transition-all duration-200",
				isDragging && "z-50 opacity-70",
			)}
			ref={setNodeRef}
			style={style}
		>
			{children({
				isDragging,
				dragHandleProps: { attributes, listeners },
			})}
		</div>
	);
}

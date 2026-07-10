"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	rectSortingStrategy,
} from "@dnd-kit/sortable";
import type { ReactNode } from "react";

interface DashboardGridProps {
	isEditMode: boolean;
	sortableIds: string[];
	onReorder: (activeId: string, overId: string) => void;
	children: ReactNode;
}

export function DashboardGrid({
	isEditMode,
	sortableIds,
	onReorder,
	children,
}: DashboardGridProps) {
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 8 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		onReorder(active.id as string, over.id as string);
	};

	const grid = (
		<div className="mx-auto grid w-full max-w-screen-2xl grid-cols-12 gap-4">
			{children}
		</div>
	);

	if (!isEditMode) {
		return grid;
	}

	return (
		<DndContext
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
			sensors={sensors}
		>
			<SortableContext items={sortableIds} strategy={rectSortingStrategy}>
				{grid}
			</SortableContext>
		</DndContext>
	);
}

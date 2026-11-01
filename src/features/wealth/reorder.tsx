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
	restrictToParentElement,
	restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode, Ref } from "react";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";

type Named = { id: string; name: string };

/**
 * Drag to reorder one group of rows (Custom sort only). Mouse and touch drag
 * the grip; the keyboard lifts it with Space, moves with the arrow keys and
 * drops with Space, and a screen reader hears each step. Rows move on the
 * row duration, which is 1ms under reduced motion (tokens.css).
 */
export function ReorderGroup({
	items,
	onMove,
	children,
}: {
	items: readonly Named[];
	/** The item at `from` now sits at `to`. */
	onMove: (from: number, to: number) => void;
	children: ReactNode;
}) {
	const t = useTranslations("wealthPage.sort");
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const find = (id: unknown) => items.findIndex((i) => i.id === id);
	const say = (
		key: "picked" | "moved" | "dropped",
		id: unknown,
		over: unknown,
	) =>
		t(key, {
			name: items[find(id)]?.name ?? "",
			position: find(over ?? id) + 1,
			count: items.length,
		});
	const end = ({ active, over }: DragEndEvent) => {
		if (!over) return;
		const from = find(active.id);
		const to = find(over.id);
		if (from >= 0 && to >= 0 && from !== to) onMove(from, to);
	};
	return (
		<DndContext
			accessibility={{
				announcements: {
					onDragStart: ({ active }) => say("picked", active.id, active.id),
					onDragOver: ({ active, over }) => say("moved", active.id, over?.id),
					onDragEnd: ({ active, over }) => say("dropped", active.id, over?.id),
					onDragCancel: () => t("cancelled"),
				},
				screenReaderInstructions: { draggable: t("instructions") },
			}}
			collisionDetection={closestCenter}
			modifiers={[restrictToVerticalAxis, restrictToParentElement]}
			onDragEnd={end}
			sensors={sensors}
		>
			<SortableContext
				items={items.map((i) => i.id)}
				strategy={verticalListSortingStrategy}
			>
				{children}
			</SortableContext>
		</DndContext>
	);
}

/** What a sortable row needs: its ref, style and class, and the grip to put in it. */
export function SortableItem({
	id,
	name,
	children,
}: {
	id: string;
	name: string;
	children: (parts: {
		ref: Ref<HTMLLIElement>;
		style: CSSProperties;
		className: string;
		handle: ReactNode;
	}) => ReactNode;
}) {
	const t = useTranslations("wealthPage.sort");
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });
	const label = t("reorder", { name });
	return children({
		ref: setNodeRef,
		style: {
			transform: CSS.Translate.toString(transform),
			transition: transition ? "transform var(--t-row) ease-out" : undefined,
		},
		className: isDragging ? "bg-raised z-20" : "",
		handle: (
			<Tip content={label}>
				<Button
					aria-label={label}
					className="touch-none cursor-grab"
					icon
					kind="ghost"
					ref={setActivatorNodeRef}
					{...attributes}
					{...listeners}
				>
					<GripVertical />
				</Button>
			</Tip>
		),
	});
}

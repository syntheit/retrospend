"use client";

import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
	closestCenter,
	DndContext,
	DragOverlay,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Settings, X } from "lucide-react";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { CategoryPicker } from "~/components/category-picker";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/components/ui/dialog";
import { Separator } from "~/components/ui/separator";
import { useAnalyticsCategoryPreferences } from "~/hooks/use-page-settings";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface AnalyticsSettingsModalProps {
	children?: React.ReactNode;
}

export interface AnalyticsSettingsModalHandle {
	hasUnsavedChanges: () => boolean;
	triggerUnsavedDialog: () => void;
}

interface CategoryPreference {
	categoryId: string;
	isFlexible: boolean;
	category: {
		id: string;
		name: string;
		color: string;
	};
}

interface SortableCategoryItemProps {
	preference: CategoryPreference;
	onRemove: (categoryId: string) => void;
	isDragging?: boolean;
}

interface DroppableZoneProps {
	id: string;
	children: React.ReactNode;
	className?: string;
}

function DroppableZone({ id, children, className }: DroppableZoneProps) {
	const { setNodeRef } = useDroppable({
		id,
	});

	return (
		<div className={className} ref={setNodeRef}>
			{children}
		</div>
	);
}

function CategoryColorDot({ color }: { color: string }) {
	return (
		<div
			className={cn(
				"h-3 w-3 flex-shrink-0 rounded-full",
				CATEGORY_COLOR_MAP[color as keyof typeof CATEGORY_COLOR_MAP]?.split(
					" ",
				)[0] || "bg-gray-400",
			)}
		/>
	);
}

function SortableCategoryItem({
	preference,
	onRemove,
	isDragging = false,
}: SortableCategoryItemProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging: isSortableDragging,
	} = useSortable({ id: preference.categoryId });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			className={cn(
				"flex items-center justify-between rounded-md border bg-muted/30 p-3",
				(isDragging || isSortableDragging) && "opacity-50",
			)}
			ref={setNodeRef}
			style={style}
		>
			<div className="flex items-center gap-2">
				<div
					{...attributes}
					{...listeners}
					className="cursor-grab hover:cursor-grabbing"
				>
					<GripVertical className="h-4 w-4 text-muted-foreground" />
				</div>
				<CategoryColorDot color={preference.category.color} />
				<span className="font-medium text-sm">{preference.category.name}</span>
			</div>
			<Button
				className="h-6 w-6"
				onClick={() => onRemove(preference.categoryId)}
				size="icon"
				variant="ghost"
			>
				<X className="h-3 w-3" />
			</Button>
		</div>
	);
}

export const AnalyticsSettingsModal = forwardRef<
	AnalyticsSettingsModalHandle,
	AnalyticsSettingsModalProps
>(({ children }, ref) => {
	const [open, setOpen] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [fixedCategories, setFixedCategories] = useState<CategoryPreference[]>(
		[],
	);
	const [flexibleCategories, setFlexibleCategories] = useState<
		CategoryPreference[]
	>([]);
	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
	const hasUnsavedChangesRef = useRef(false);

	const { preferences, updatePreference, deletePreference, isUpdating } =
		useAnalyticsCategoryPreferences();
	const { data: allCategories } = api.user.listCategories.useQuery(undefined);
	const utils = api.useUtils();

	useImperativeHandle(
		ref,
		() => ({
			hasUnsavedChanges: () => hasUnsavedChangesRef.current,
			triggerUnsavedDialog: () => setShowUnsavedDialog(true),
		}),
		[],
	);

	const initialized =
		fixedCategories.length > 0 ||
		flexibleCategories.length > 0 ||
		Boolean(preferences);

	useEffect(() => {
		if (open && preferences) {
			setFixedCategories(preferences.filter((pref) => !pref.isFlexible));
			setFlexibleCategories(preferences.filter((pref) => pref.isFlexible));
		}
	}, [open, preferences]);

	const hasUnsavedChanges = useMemo(() => {
		if (!preferences || !initialized) return false;

		const currentCategories = [...fixedCategories, ...flexibleCategories];
		const originalCategories = preferences;

		return (
			currentCategories.length !== originalCategories.length ||
			currentCategories.some((current) => {
				const original = originalCategories.find(
					(pref) => pref.categoryId === current.categoryId,
				);
				return !original || original.isFlexible !== current.isFlexible;
			})
		);
	}, [preferences, fixedCategories, flexibleCategories, initialized]);

	useEffect(() => {
		hasUnsavedChangesRef.current = hasUnsavedChanges;
	}, [hasUnsavedChanges]);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8,
			},
		}),
	);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveId(null);

		if (!over) return;

		const activeId = active.id as string;
		const overId = over.id as string;

		const isFromFixed = fixedCategories.some(
			(cat) => cat.categoryId === activeId,
		);

		const isToFixed =
			overId === "fixed-drop-zone" ||
			fixedCategories.some((cat) => cat.categoryId === overId);

		const isToFlexible =
			overId === "flexible-drop-zone" ||
			flexibleCategories.some((cat) => cat.categoryId === overId);

		if (isFromFixed && isToFlexible) {
			const category = fixedCategories.find(
				(cat) => cat.categoryId === activeId,
			);
			if (category) {
				setFixedCategories((prev) =>
					prev.filter((cat) => cat.categoryId !== activeId),
				);
				setFlexibleCategories((prev) => [
					...prev,
					{ ...category, isFlexible: true },
				]);
			}
		} else if (!isFromFixed && isToFixed) {
			const category = flexibleCategories.find(
				(cat) => cat.categoryId === activeId,
			);
			if (category) {
				setFlexibleCategories((prev) =>
					prev.filter((cat) => cat.categoryId !== activeId),
				);
				setFixedCategories((prev) => [
					...prev,
					{ ...category, isFlexible: false },
				]);
			}
		} else if (isFromFixed && isToFixed) {
			const oldIndex = fixedCategories.findIndex(
				(cat) => cat.categoryId === activeId,
			);
			const newIndex = fixedCategories.findIndex(
				(cat) => cat.categoryId === overId,
			);
			if (oldIndex !== -1 && newIndex !== -1) {
				setFixedCategories((prev) => arrayMove(prev, oldIndex, newIndex));
			}
		} else if (!isFromFixed && isToFlexible) {
			const oldIndex = flexibleCategories.findIndex(
				(cat) => cat.categoryId === activeId,
			);
			const newIndex = flexibleCategories.findIndex(
				(cat) => cat.categoryId === overId,
			);
			if (oldIndex !== -1 && newIndex !== -1) {
				setFlexibleCategories((prev) => arrayMove(prev, oldIndex, newIndex));
			}
		}
	};

	const handleAddCategory = (categoryId: string) => {
		const category = allCategories?.find((cat) => cat.id === categoryId);
		if (!category) return;

		if (
			[...fixedCategories, ...flexibleCategories].some(
				(pref) => pref.categoryId === categoryId,
			)
		) {
			return;
		}

		setFlexibleCategories((prev) => [
			...prev,
			{
				categoryId,
				isFlexible: true,
				category,
			},
		]);
	};

	const handleRemoveCategory = (categoryId: string) => {
		setFixedCategories((prev) =>
			prev.filter((cat) => cat.categoryId !== categoryId),
		);
		setFlexibleCategories((prev) =>
			prev.filter((cat) => cat.categoryId !== categoryId),
		);
	};

	const handleSave = async () => {
		if (!preferences) return;

		const currentCategories = [...fixedCategories, ...flexibleCategories];
		const originalCategories = preferences;

		const updates: Array<{ categoryId: string; isFlexible: boolean }> = [];
		const deletions: string[] = [];

		for (const current of currentCategories) {
			const original = originalCategories.find(
				(pref) => pref.categoryId === current.categoryId,
			);
			if (!original || original.isFlexible !== current.isFlexible) {
				updates.push({
					categoryId: current.categoryId,
					isFlexible: current.isFlexible,
				});
			}
		}

		for (const original of originalCategories) {
			const stillExists = currentCategories.some(
				(current) => current.categoryId === original.categoryId,
			);
			if (!stillExists) {
				deletions.push(original.categoryId);
			}
		}

		await Promise.all([
			...updates.map(({ categoryId, isFlexible }) =>
				updatePreference(categoryId, isFlexible),
			),
			...deletions.map((categoryId) => deletePreference(categoryId)),
		]);

		await Promise.all([
			utils.settings.getAnalyticsCategoryPreferences.invalidate(),
			utils.settings.getAnalyticsCategoryPreferenceMap.invalidate(),
		]);

		setOpen(false);
	};

	const handleCancel = () => {
		if (preferences) {
			setFixedCategories(preferences.filter((pref) => !pref.isFlexible));
			setFlexibleCategories(preferences.filter((pref) => pref.isFlexible));
		}
		setOpen(false);
	};

	const availableCategories = useMemo(
		() =>
			allCategories?.filter(
				(category) =>
					![...fixedCategories, ...flexibleCategories].some(
						(pref) => pref.categoryId === category.id,
					),
			) || [],
		[allCategories, fixedCategories, flexibleCategories],
	);

	const activeCategory = useMemo(
		() =>
			activeId
				? [...fixedCategories, ...flexibleCategories].find(
						(cat) => cat.categoryId === activeId,
					)
				: null,
		[activeId, fixedCategories, flexibleCategories],
	);

	const handleDiscardChanges = () => {
		if (preferences) {
			setFixedCategories(preferences.filter((pref) => !pref.isFlexible));
			setFlexibleCategories(preferences.filter((pref) => pref.isFlexible));
		}
		setShowUnsavedDialog(false);
		hasUnsavedChangesRef.current = false;
		setOpen(false);
	};

	const handleStay = () => setShowUnsavedDialog(false);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && hasUnsavedChangesRef.current) {
			setShowUnsavedDialog(true);
			return;
		}
		setOpen(nextOpen);
	};

	return (
		<>
			<Dialog onOpenChange={handleOpenChange} open={open}>
				<DialogTrigger asChild>
					{children || (
						<Button className="h-8 w-8" size="icon" variant="ghost">
							<Settings className="h-4 w-4" />
							<span className="sr-only">Analytics settings</span>
						</Button>
					)}
				</DialogTrigger>
				<DialogContent className="flex h-[780px] max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Analytics Settings</DialogTitle>
						<DialogDescription>
							Configure how categories are treated in trend analysis. Drag
							categories between fixed and flexible, or add new categories.
						</DialogDescription>
					</DialogHeader>

					{initialized && (
						<DndContext
							collisionDetection={closestCenter}
							modifiers={[restrictToWindowEdges]}
							onDragEnd={handleDragEnd}
							onDragStart={handleDragStart}
							sensors={sensors}
						>
							<div className="flex min-h-0 flex-1 flex-col gap-4">
								<div className="grid min-h-0 flex-1 grid-cols-1 gap-6 md:grid-cols-2">
									{/* Fixed Categories Section */}
									<div className="flex h-full flex-col space-y-3 overflow-hidden">
										<div className="flex-none">
											<h4 className="font-medium text-sm">Fixed Categories</h4>
											<p className="text-muted-foreground text-xs">
												Predictable expenses (rent, utilities, subscriptions)
											</p>
										</div>

										<DroppableZone
											className="flex-1 space-y-2 overflow-y-auto rounded-lg border-2 border-muted border-dashed p-4"
											id="fixed-drop-zone"
										>
											{fixedCategories.length === 0 ? (
												<div className="flex h-full items-center justify-center">
													<p className="text-muted-foreground text-sm">
														Drop fixed categories here
													</p>
												</div>
											) : (
												<SortableContext
													items={fixedCategories.map((cat) => cat.categoryId)}
													strategy={verticalListSortingStrategy}
												>
													{fixedCategories.map((pref) => (
														<SortableCategoryItem
															key={pref.categoryId}
															onRemove={handleRemoveCategory}
															preference={pref}
														/>
													))}
												</SortableContext>
											)}
										</DroppableZone>
									</div>

									{/* Flexible Categories Section */}
									<div className="flex h-full flex-col space-y-3 overflow-hidden">
										<div className="flex-none">
											<h4 className="font-medium text-sm">
												Flexible Categories
											</h4>
											<p className="text-muted-foreground text-xs">
												Variable expenses (dining, entertainment, shopping)
											</p>
										</div>

										<DroppableZone
											className="flex-1 space-y-2 overflow-y-auto rounded-lg border-2 border-muted border-dashed p-4"
											id="flexible-drop-zone"
										>
											{flexibleCategories.length === 0 ? (
												<div className="flex h-full items-center justify-center">
													<p className="text-muted-foreground text-sm">
														Drop flexible categories here
													</p>
												</div>
											) : (
												<SortableContext
													items={flexibleCategories.map(
														(cat) => cat.categoryId,
													)}
													strategy={verticalListSortingStrategy}
												>
													{flexibleCategories.map((pref) => (
														<SortableCategoryItem
															key={pref.categoryId}
															onRemove={handleRemoveCategory}
															preference={pref}
														/>
													))}
												</SortableContext>
											)}
										</DroppableZone>
									</div>
								</div>

								{/* Add Category Section */}
								{availableCategories.length > 0 && (
									<div className="flex-none space-y-3">
										<Separator />
										<div>
											<h4 className="font-medium text-sm">Add Category</h4>
											<p className="text-muted-foreground text-xs">
												Add new categories to configure their analytics behavior
											</p>
										</div>

										<div className="flex gap-2">
											<CategoryPicker
												categories={availableCategories}
												className="flex-1"
												onValueChange={handleAddCategory}
												placeholder="Select category to add"
											/>
											<Button
												disabled={!availableCategories.length}
												size="icon"
												type="button"
												variant="outline"
											>
												<Plus className="h-4 w-4" />
											</Button>
										</div>
									</div>
								)}
							</div>

							{createPortal(
								<DragOverlay>
									{activeCategory && (
										<div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 shadow-lg">
											<GripVertical className="h-4 w-4 text-muted-foreground" />
											<CategoryColorDot color={activeCategory.category.color} />
											<span className="font-medium text-sm">
												{activeCategory.category.name}
											</span>
										</div>
									)}
								</DragOverlay>,
								document.body,
							)}
						</DndContext>
					)}

					<DialogFooter className="flex-col gap-2 sm:flex-row">
						<Button
							className="w-full sm:w-auto"
							onClick={handleCancel}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							className="w-full sm:w-auto"
							disabled={isUpdating}
							onClick={handleSave}
							type="button"
						>
							{isUpdating ? "Saving..." : "Save Changes"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Unsaved Changes Confirmation Dialog */}
			<Dialog onOpenChange={setShowUnsavedDialog} open={showUnsavedDialog}>
				<DialogContent className="w-full max-w-full sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Unsaved Changes</DialogTitle>
						<DialogDescription>
							You have unsaved changes. Are you sure you want to leave without
							saving?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={handleStay} variant="outline">
							Stay
						</Button>
						<Button onClick={handleDiscardChanges} variant="destructive">
							Discard Changes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
});

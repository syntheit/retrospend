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
	useReducer,
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

type AnalyticsState = {
	fixed: CategoryPreference[];
	flexible: CategoryPreference[];
	original: CategoryPreference[];
	hasChanges: boolean;
	initialized: boolean;
};

type AnalyticsAction =
	| { type: "INITIALIZE_DATA"; preferences: CategoryPreference[] }
	| { type: "MOVE_ITEM"; activeId: string; overId: string }
	| {
			type: "ADD_CATEGORY";
			category: { id: string; name: string; color: string };
	  }
	| { type: "REMOVE_CATEGORY"; categoryId: string }
	| { type: "RESET"; preferences: CategoryPreference[] };

const calculateChanges = (
	fixed: CategoryPreference[],
	flexible: CategoryPreference[],
	original: CategoryPreference[],
) => {
	const current = [...fixed, ...flexible];
	if (current.length !== original.length) return true;
	return current.some((c) => {
		const o = original.find((op) => op.categoryId === c.categoryId);
		return !o || o.isFlexible !== c.isFlexible;
	});
};

const analyticsReducer = (
	state: AnalyticsState,
	action: AnalyticsAction,
): AnalyticsState => {
	switch (action.type) {
		case "INITIALIZE_DATA": {
			const fixed = action.preferences.filter((p) => !p.isFlexible);
			const flexible = action.preferences.filter((p) => p.isFlexible);
			return {
				fixed,
				flexible,
				original: action.preferences,
				hasChanges: false,
				initialized: true,
			};
		}

		case "MOVE_ITEM": {
			const { activeId, overId } = action;
			const isFromFixed = state.fixed.some(
				(cat) => cat.categoryId === activeId,
			);

			let nextState = { ...state };

			const isToFixed =
				overId === "fixed-drop-zone" ||
				state.fixed.some((cat) => cat.categoryId === overId);

			const isToFlexible =
				overId === "flexible-drop-zone" ||
				state.flexible.some((cat) => cat.categoryId === overId);

			if (isFromFixed && isToFlexible) {
				const category = state.fixed.find((cat) => cat.categoryId === activeId);
				if (category) {
					nextState = {
						...state,
						fixed: state.fixed.filter((cat) => cat.categoryId !== activeId),
						flexible: [...state.flexible, { ...category, isFlexible: true }],
					};
				}
			} else if (!isFromFixed && isToFixed) {
				const category = state.flexible.find(
					(cat) => cat.categoryId === activeId,
				);
				if (category) {
					nextState = {
						...state,
						flexible: state.flexible.filter(
							(cat) => cat.categoryId !== activeId,
						),
						fixed: [...state.fixed, { ...category, isFlexible: false }],
					};
				}
			} else if (isFromFixed && isToFixed) {
				const oldIndex = state.fixed.findIndex(
					(cat) => cat.categoryId === activeId,
				);
				const newIndex = state.fixed.findIndex(
					(cat) => cat.categoryId === overId,
				);
				if (oldIndex !== -1 && newIndex !== -1) {
					nextState = {
						...state,
						fixed: arrayMove(state.fixed, oldIndex, newIndex),
					};
				}
			} else if (!isFromFixed && isToFlexible) {
				const oldIndex = state.flexible.findIndex(
					(cat) => cat.categoryId === activeId,
				);
				const newIndex = state.flexible.findIndex(
					(cat) => cat.categoryId === overId,
				);
				if (oldIndex !== -1 && newIndex !== -1) {
					nextState = {
						...state,
						flexible: arrayMove(state.flexible, oldIndex, newIndex),
					};
				}
			}

			return {
				...nextState,
				hasChanges: calculateChanges(
					nextState.fixed,
					nextState.flexible,
					state.original,
				),
			};
		}

		case "ADD_CATEGORY": {
			if (
				[...state.fixed, ...state.flexible].some(
					(pref) => pref.categoryId === action.category.id,
				)
			) {
				return state;
			}
			const nextFlexible = [
				...state.flexible,
				{
					categoryId: action.category.id,
					isFlexible: true,
					category: action.category,
				},
			];
			return {
				...state,
				flexible: nextFlexible,
				hasChanges: calculateChanges(state.fixed, nextFlexible, state.original),
			};
		}

		case "REMOVE_CATEGORY": {
			const nextFixed = state.fixed.filter(
				(cat) => cat.categoryId !== action.categoryId,
			);
			const nextFlexible = state.flexible.filter(
				(cat) => cat.categoryId !== action.categoryId,
			);
			return {
				...state,
				fixed: nextFixed,
				flexible: nextFlexible,
				hasChanges: calculateChanges(nextFixed, nextFlexible, state.original),
			};
		}

		case "RESET": {
			const fixed = action.preferences.filter((p) => !p.isFlexible);
			const flexible = action.preferences.filter((p) => p.isFlexible);
			return {
				fixed,
				flexible,
				original: action.preferences,
				hasChanges: false,
				initialized: true,
			};
		}

		default:
			return state;
	}
};

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
	const [state, dispatch] = useReducer(analyticsReducer, {
		fixed: [],
		flexible: [],
		original: [],
		hasChanges: false,
		initialized: false,
	});
	const { fixed, flexible, initialized, hasChanges } = state;

	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
	const hasUnsavedChangesRef = useRef(false);

	const { preferences, updatePreference, deletePreference, isUpdating } =
		useAnalyticsCategoryPreferences();
	const { data: allCategories } = api.categories.getAll.useQuery(undefined);
	const utils = api.useUtils();

	useImperativeHandle(
		ref,
		() => ({
			hasUnsavedChanges: () => hasUnsavedChangesRef.current,
			triggerUnsavedDialog: () => setShowUnsavedDialog(true),
		}),
		[],
	);

	useEffect(() => {
		if (open && preferences) {
			dispatch({ type: "INITIALIZE_DATA", preferences });
		}
	}, [open, preferences]);

	useEffect(() => {
		hasUnsavedChangesRef.current = hasChanges;
	}, [hasChanges]);

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

		if (over) {
			dispatch({
				type: "MOVE_ITEM",
				activeId: active.id as string,
				overId: over.id as string,
			});
		}
	};

	const handleAddCategory = (categoryId: string) => {
		const category = allCategories?.find((cat) => cat.id === categoryId);
		if (!category) return;
		dispatch({ type: "ADD_CATEGORY", category });
	};

	const handleRemoveCategory = (categoryId: string) => {
		dispatch({ type: "REMOVE_CATEGORY", categoryId });
	};

	const handleSave = async () => {
		if (!preferences) return;

		const currentCategories = [...fixed, ...flexible];
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
			dispatch({ type: "RESET", preferences });
		}
		setOpen(false);
	};

	const availableCategories = useMemo(
		() =>
			allCategories?.filter(
				(category) =>
					![...fixed, ...flexible].some(
						(pref) => pref.categoryId === category.id,
					),
			) || [],
		[allCategories, fixed, flexible],
	);

	const activeCategory = useMemo(
		() =>
			activeId
				? [...fixed, ...flexible].find((cat) => cat.categoryId === activeId)
				: null,
		[activeId, fixed, flexible],
	);

	const handleDiscardChanges = () => {
		if (preferences) {
			dispatch({ type: "RESET", preferences });
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
											{fixed.length === 0 ? (
												<div className="flex h-full items-center justify-center">
													<p className="text-muted-foreground text-sm">
														Drop fixed categories here
													</p>
												</div>
											) : (
												<SortableContext
													items={fixed.map((cat) => cat.categoryId)}
													strategy={verticalListSortingStrategy}
												>
													{fixed.map((pref) => (
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
											{flexible.length === 0 ? (
												<div className="flex h-full items-center justify-center">
													<p className="text-muted-foreground text-sm">
														Drop flexible categories here
													</p>
												</div>
											) : (
												<SortableContext
													items={flexible.map((cat) => cat.categoryId)}
													strategy={verticalListSortingStrategy}
												>
													{flexible.map((pref) => (
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

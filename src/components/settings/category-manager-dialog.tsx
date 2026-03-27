"use client";

import { ArrowLeft, Check, Circle, Plus, Trash2, X } from "lucide-react";
import {
	createElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { CATEGORY_ICON_REGISTRY, getCategoryIcon, getCategoryIconName } from "~/lib/category-icons";
import { getCategoryColorClasses, COLOR_TO_HEX, type CategoryColor } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const ICON_OPTIONS = Object.keys(CATEGORY_ICON_REGISTRY);

// 12 visually distinct colors, one clear step apart across the spectrum
const PICKER_COLORS: CategoryColor[] = [
	"red",
	"rose",
	"orange",
	"amber",
	"lime",
	"emerald",
	"teal",
	"sky",
	"blue",
	"indigo",
	"purple",
	"slate",
];

interface CategoryManagerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface CategoryData {
	name: string;
	icon?: string | null;
	color: string;
	excludeByDefault: boolean;
}

export function CategoryManagerDialog({
	open,
	onOpenChange,
}: CategoryManagerDialogProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [mobileView, setMobileView] = useState<"list" | "detail">("list");

	// Edit state
	const [editName, setEditName] = useState("");
	const [editIcon, setEditIcon] = useState("Tag");
	const [editColor, setEditColor] = useState<CategoryColor>("emerald");
	const [editExclude, setEditExclude] = useState(false);

	// Ref for latest edit state (prevents stale closures in debounced saves)
	const editStateRef = useRef({
		name: "",
		icon: "Tag",
		color: "emerald" as CategoryColor,
		excludeByDefault: false,
	});
	editStateRef.current = {
		name: editName,
		icon: editIcon,
		color: editColor,
		excludeByDefault: editExclude,
	};

	// Save indicator
	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
		"idle",
	);
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const nameDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const nameInputRef = useRef<HTMLInputElement>(null);

	// Delete state
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [showReassignDialog, setShowReassignDialog] = useState(false);
	const [reassignExpenseCount, setReassignExpenseCount] = useState(0);
	const [replacementCategoryId, setReplacementCategoryId] =
		useState("uncategorized");

	// tRPC
	const { data: categories, refetch: refetchCategories } =
		api.categories.getAll.useQuery();
	const createMutation = api.categories.create.useMutation();
	const updateMutation = api.categories.update.useMutation();
	const deleteMutation = api.categories.delete.useMutation();

	const selectedCategory = categories?.find((c) => c.id === selectedId);

	// Populate editor fields from a category object
	const syncEditor = useCallback((cat: CategoryData) => {
		setEditName(cat.name);
		setEditIcon(cat.icon || getCategoryIconName(cat.name));
		setEditColor(cat.color as CategoryColor);
		setEditExclude(cat.excludeByDefault);
	}, []);

	const flashSaved = useCallback(() => {
		setSaveStatus("saved");
		if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
		saveTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
	}, []);

	// Core save — takes explicit id + values to avoid stale closures
	const saveCategory = useCallback(
		async (
			id: string,
			values: {
				name: string;
				icon: string;
				color: CategoryColor;
				excludeByDefault: boolean;
			},
		) => {
			if (!values.name.trim()) return;
			setSaveStatus("saving");
			try {
				await updateMutation.mutateAsync({
					id,
					name: values.name.trim(),
					color: values.color,
					icon: values.icon,
					excludeByDefault: values.excludeByDefault,
				});
				await refetchCategories();
				flashSaved();
			} catch (err) {
				setSaveStatus("idle");
				toast.error(
					err instanceof Error ? err.message : "Failed to save",
				);
			}
		},
		[updateMutation, refetchCategories, flashSaved],
	);

	const saveFnRef = useRef(saveCategory);
	saveFnRef.current = saveCategory;

	// Auto-select first category when dialog opens
	useEffect(() => {
		if (!open || selectedId || !categories?.length) return;
		const first = categories[0];
		if (!first) return;
		setSelectedId(first.id);
		syncEditor(first);
	}, [open, categories, selectedId, syncEditor]);

	// Reset mobile view when dialog opens
	useEffect(() => {
		if (open) setMobileView("list");
	}, [open]);

	// Clear delete confirm when switching categories
	useEffect(() => {
		setShowDeleteConfirm(false);
	}, [selectedId]);

	// Cleanup timeouts
	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
			if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
		};
	}, []);

	// Flush pending name debounce (called before switching selection or closing)
	const flushPendingSave = useCallback(() => {
		if (nameDebounceRef.current && selectedId) {
			clearTimeout(nameDebounceRef.current);
			nameDebounceRef.current = undefined;
			const state = editStateRef.current;
			if (state.name.trim()) {
				saveFnRef.current(selectedId, state);
			}
		}
	}, [selectedId]);

	// Select a category (flush pending save first)
	const handleSelectCategory = useCallback(
		(id: string) => {
			flushPendingSave();
			const cat = categories?.find((c) => c.id === id);
			setSelectedId(id);
			if (cat) syncEditor(cat);
			setMobileView("detail");
			setSaveStatus("idle");
		},
		[flushPendingSave, categories, syncEditor],
	);

	// Dialog close handler
	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				flushPendingSave();
				setSelectedId(null);
			}
			onOpenChange(nextOpen);
		},
		[flushPendingSave, onOpenChange],
	);

	// --- Field change handlers ---

	const handleNameChange = useCallback(
		(value: string) => {
			setEditName(value);
			editStateRef.current.name = value;
			if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
			const id = selectedId;
			nameDebounceRef.current = setTimeout(() => {
				if (value.trim() && id) {
					saveFnRef.current(id, {
						...editStateRef.current,
						name: value,
					});
				}
			}, 500);
		},
		[selectedId],
	);

	const handleIconChange = useCallback(
		(iconName: string) => {
			setEditIcon(iconName);
			editStateRef.current.icon = iconName;
			// Clear pending name debounce — this save includes current name
			if (nameDebounceRef.current) {
				clearTimeout(nameDebounceRef.current);
				nameDebounceRef.current = undefined;
			}
			if (selectedId) {
				saveFnRef.current(selectedId, {
					...editStateRef.current,
					icon: iconName,
				});
			}
		},
		[selectedId],
	);

	const handleColorChange = useCallback(
		(color: CategoryColor) => {
			setEditColor(color);
			editStateRef.current.color = color;
			if (nameDebounceRef.current) {
				clearTimeout(nameDebounceRef.current);
				nameDebounceRef.current = undefined;
			}
			if (selectedId) {
				saveFnRef.current(selectedId, {
					...editStateRef.current,
					color,
				});
			}
		},
		[selectedId],
	);

	const handleExcludeChange = useCallback(
		(value: boolean) => {
			setEditExclude(value);
			editStateRef.current.excludeByDefault = value;
			if (nameDebounceRef.current) {
				clearTimeout(nameDebounceRef.current);
				nameDebounceRef.current = undefined;
			}
			if (selectedId) {
				saveFnRef.current(selectedId, {
					...editStateRef.current,
					excludeByDefault: value,
				});
			}
		},
		[selectedId],
	);

	// --- Add category ---
	const handleAddCategory = useCallback(async () => {
		flushPendingSave();
		const usedNames = new Set(
			categories?.map((c) => c.name.toLowerCase()) ?? [],
		);
		let name = "New Category";
		let counter = 2;
		while (usedNames.has(name.toLowerCase())) {
			name = `New Category ${counter}`;
			counter++;
		}
		const usedColors = new Set(categories?.map((c) => c.color) ?? []);
		const color =
			PICKER_COLORS.find((c) => !usedColors.has(c)) ?? PICKER_COLORS[0]!;

		try {
			const created = await createMutation.mutateAsync({
				name,
				color,
				icon: "Tag",
			});
			const result = await refetchCategories();
			const newCat = result.data?.find(
				(c: { id: string }) => c.id === created.id,
			);
			setSelectedId(created.id);
			if (newCat) syncEditor(newCat);
			setMobileView("detail");
			setTimeout(() => {
				nameInputRef.current?.focus();
				nameInputRef.current?.select();
			}, 100);
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: "Failed to create category",
			);
		}
	}, [
		flushPendingSave,
		categories,
		createMutation,
		refetchCategories,
		syncEditor,
	]);

	// --- Delete category ---
	const confirmDelete = useCallback(async () => {
		if (!selectedId) return;
		try {
			await deleteMutation.mutateAsync({ id: selectedId });
			const result = await refetchCategories();
			setShowDeleteConfirm(false);
			const remaining = result.data?.filter(
				(c: { id: string }) => c.id !== selectedId,
			);
			const next = remaining?.[0];
			setSelectedId(next?.id ?? null);
			if (next) syncEditor(next);
			setMobileView("list");
			toast.success("Category deleted");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to delete";
			const match = errMsg.match(/has (\d+) expense/);
			if (match?.[1]) {
				setShowDeleteConfirm(false);
				setReassignExpenseCount(Number(match[1]));
				setReplacementCategoryId("uncategorized");
				setShowReassignDialog(true);
				return;
			}
			toast.error(errMsg);
		}
	}, [selectedId, deleteMutation, refetchCategories, syncEditor]);

	const handleReassignAndDelete = useCallback(async () => {
		if (!selectedId) return;
		try {
			const isUncategorized = replacementCategoryId === "uncategorized";
			await deleteMutation.mutateAsync({
				id: selectedId,
				replacementCategoryId: isUncategorized
					? undefined
					: replacementCategoryId,
				reassignToUncategorized: isUncategorized,
			});
			const result = await refetchCategories();
			setShowReassignDialog(false);
			const remaining = result.data?.filter(
				(c: { id: string }) => c.id !== selectedId,
			);
			const next = remaining?.[0];
			setSelectedId(next?.id ?? null);
			if (next) syncEditor(next);
			setMobileView("list");
			toast.success("Category deleted and expenses reassigned");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to delete",
			);
		}
	}, [
		selectedId,
		replacementCategoryId,
		deleteMutation,
		refetchCategories,
		syncEditor,
	]);

	// Always include current color in picker if it's not in the reduced set
	const displayColors = PICKER_COLORS.includes(editColor)
		? PICKER_COLORS
		: [editColor, ...PICKER_COLORS];

	return (
		<>
			<ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
				<ResponsiveDialogContent
					className="flex h-[80vh] max-h-[700px] sm:max-w-3xl flex-col gap-0 overflow-hidden p-0"
					showCloseButton={false}
				>
					{/* Header */}
					<ResponsiveDialogHeader className="flex flex-row items-center justify-between border-b px-6 py-4">
						<div>
							<ResponsiveDialogTitle>Category Manager</ResponsiveDialogTitle>
							<ResponsiveDialogDescription className="sr-only">
								Manage your expense categories
							</ResponsiveDialogDescription>
						</div>
						<div className="flex items-center gap-3">
							<div className="flex h-5 items-center">
								{saveStatus === "saving" && (
									<span className="animate-pulse text-xs text-muted-foreground">
										Saving...
									</span>
								)}
								{saveStatus === "saved" && (
									<span className="flex animate-in fade-in items-center gap-1 text-xs text-emerald-500 duration-200">
										<Check className="h-3 w-3" />
										Saved
									</span>
								)}
							</div>
							<Button
								size="sm"
								variant="outline"
								className="gap-1.5"
								onClick={handleAddCategory}
								disabled={createMutation.isPending}
							>
								<Plus className="h-4 w-4" />
								<span className="hidden sm:inline">
									Add Category
								</span>
								<span className="sm:hidden">Add</span>
							</Button>
							<Button
								onClick={() => handleOpenChange(false)}
								variant="ghost"
								size="icon"
								className="h-7 w-7 opacity-70 hover:opacity-100"
							>
								<X className="h-4 w-4" />
								<span className="sr-only">Close</span>
							</Button>
						</div>
					</ResponsiveDialogHeader>

					{/* Two-panel body */}
					<div className="flex min-h-0 flex-1">
						{/* LEFT PANEL — Category List */}
						<div
							className={cn(
								"w-[200px] shrink-0 border-r",
								"max-md:w-full",
								mobileView === "detail" && "max-md:hidden",
							)}
						>
							<ScrollArea className="h-full">
								<div className="flex flex-col py-1">
									{categories?.map((category) => {
										const Icon = getCategoryIcon(
											category.name,
											category.icon,
										);
										const isSelected =
											category.id === selectedId;
										return (
											<Button
												key={category.id}
												type="button"
												onClick={() =>
													handleSelectCategory(
														category.id,
													)
												}
												variant="ghost"
												className={cn(
													"flex h-auto w-full items-center justify-start gap-3 rounded-none px-4 py-2.5",
													isSelected && "bg-accent",
												)}
											>
												<div
													className={cn(
														"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
														getCategoryColorClasses(category.color, "light"),
													)}
												>
													{createElement(Icon, {
														className: "h-4 w-4",
													})}
												</div>
												<span className="truncate text-sm font-medium">
													{category.name}
												</span>
											</Button>
										);
									})}
								</div>
							</ScrollArea>
						</div>

						{/* RIGHT PANEL — Detail Editor */}
						<div
							className={cn(
								"min-w-0 flex-1",
								mobileView === "list" && "max-md:hidden",
							)}
						>
							{selectedCategory ? (
								<ScrollArea className="h-full">
									<div className="flex flex-col gap-6 px-6 pb-6 pt-3 md:pt-[14px]">
										{/* Mobile back button */}
										<Button
											type="button"
											onClick={() => setMobileView("list")}
											variant="ghost"
											size="sm"
											className="gap-1 text-muted-foreground hover:text-foreground md:hidden"
										>
											<ArrowLeft className="h-4 w-4" />
											Back
										</Button>

										{/* Name */}
										<div className="space-y-2">
											<Label htmlFor="category-name">
												Name
											</Label>
											<Input
												id="category-name"
												ref={nameInputRef}
												value={editName}
												onChange={(e) =>
													handleNameChange(
														e.target.value,
													)
												}
												placeholder="Category name"
												maxLength={64}
											/>
										</div>

										{/* Icon picker */}
										<div className="space-y-2">
											<Label>Icon</Label>
											<div className="flex flex-wrap items-center gap-2">
												{ICON_OPTIONS.map(
													(iconName) => {
														const IconComp =
															CATEGORY_ICON_REGISTRY[iconName] ||
															Circle;
														const isSelected =
															editIcon ===
															iconName;
														const hex =
															COLOR_TO_HEX[
																editColor as keyof typeof COLOR_TO_HEX
															] || "#ccc";
														return (
															<Button
																key={iconName}
																type="button"
																onClick={() =>
																	handleIconChange(
																		iconName,
																	)
																}
																variant="outline"
																size="icon"
																className={cn(
																	"h-9 w-9 shrink-0 transition-all",
																	"hover:border-primary hover:text-primary",
																	isSelected
																		? "border-2 text-white"
																		: "text-muted-foreground",
																)}
																style={
																	isSelected
																		? {
																				backgroundColor:
																					hex,
																				borderColor:
																					hex,
																			}
																		: undefined
																}
															>
																<IconComp className="h-4 w-4" />
															</Button>
														);
													},
												)}
											</div>
										</div>

										{/* Color picker */}
										<div className="space-y-2">
											<Label>Color</Label>
											<div className="flex flex-wrap items-center gap-2">
												{displayColors.map((color) => {
													const isSelected =
														editColor === color;
													const hex =
														COLOR_TO_HEX[
															color as keyof typeof COLOR_TO_HEX
														] || "#ccc";
													return (
														<Button
															key={color}
															type="button"
															onClick={() =>
																handleColorChange(
																	color,
																)
															}
															variant="ghost"
															size="icon"
															className={cn(
																"relative h-9 w-9 shrink-0 rounded-full ring-offset-2 ring-offset-background transition-all hover:scale-110 hover:bg-transparent",
																isSelected &&
																	"ring-2 ring-primary shadow-sm",
															)}
															style={{
																backgroundColor:
																	hex,
															}}
															title={color}
														>
															{isSelected && (
																<Check className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]" />
															)}
														</Button>
													);
												})}
											</div>
										</div>

										{/* Exclude toggle */}
										<div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/30 px-4 py-3">
											<div className="flex flex-col gap-0.5">
												<Label className="font-normal">
													Exclude new expenses by
													default
												</Label>
												<p className="text-xs text-muted-foreground">
													New expenses in this
													category won&apos;t count
													toward budgets or trends.
												</p>
											</div>
											<Switch
												checked={editExclude}
												onCheckedChange={
													handleExcludeChange
												}
											/>
										</div>

										{/* Delete */}
										{categories &&
											categories.length > 1 && (
												<div className="mt-6 border-t pt-6">
													{!showDeleteConfirm ? (
														<Button
															type="button"
															onClick={() =>
																setShowDeleteConfirm(
																	true,
																)
															}
															variant="ghost"
															size="sm"
															className="gap-1.5 text-red-500 hover:bg-red-500/10 hover:text-red-600"
														>
															<Trash2 className="h-4 w-4" />
															Delete Category
														</Button>
													) : (
														<div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/20">
															<p className="mb-3 text-sm">
																Delete &ldquo;
																{
																	selectedCategory.name
																}
																&rdquo;?
																Expenses in this
																category will be
																reassigned to
																Uncategorized.
															</p>
															<div className="flex gap-2">
																<Button
																	size="sm"
																	variant="ghost"
																	onClick={() =>
																		setShowDeleteConfirm(
																			false,
																		)
																	}
																>
																	Cancel
																</Button>
																<Button
																	size="sm"
																	variant="destructive"
																	onClick={
																		confirmDelete
																	}
																	disabled={
																		deleteMutation.isPending
																	}
																>
																	{deleteMutation.isPending
																		? "Deleting..."
																		: "Delete"}
																</Button>
															</div>
														</div>
													)}
												</div>
											)}
									</div>
								</ScrollArea>
							) : (
								<div className="flex h-full items-center justify-center p-6">
									<p className="text-sm text-muted-foreground">
										Select a category to edit, or create a
										new one.
									</p>
								</div>
							)}
						</div>
					</div>
				</ResponsiveDialogContent>
			</ResponsiveDialog>

			{/* Reassignment Dialog */}
			<Dialog
				open={showReassignDialog}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) setShowReassignDialog(false);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reassign Expenses</DialogTitle>
						<DialogDescription>
							{reassignExpenseCount} expense(s) use this category.
							Choose a category to reassign them to before
							deleting.
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<Label htmlFor="replacement-category">
							Reassign to
						</Label>
						<Select
							onValueChange={setReplacementCategoryId}
							value={replacementCategoryId}
						>
							<SelectTrigger
								className="mt-2"
								id="replacement-category"
							>
								<SelectValue placeholder="Select a category" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="uncategorized">
									Uncategorized
								</SelectItem>
								{categories
									?.filter((c) => c.id !== selectedId)
									.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</div>
					<DialogFooter>
						<Button
							onClick={() => setShowReassignDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteMutation.isPending}
							onClick={handleReassignAndDelete}
							variant="destructive"
						>
							{deleteMutation.isPending
								? "Deleting..."
								: "Reassign & Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

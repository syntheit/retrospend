"use client";

import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import {
	CATEGORY_COLOR_MAP,
	CATEGORY_COLORS,
	type CategoryColor,
} from "~/lib/constants";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export function CategorySettings() {
	// Categories state
	const [showCategoryList, setShowCategoryList] = useState(false);
	const [showCategoryDialog, setShowCategoryDialog] = useState(false);
	const [editingCategory, setEditingCategory] = useState<{
		id?: string;
		name: string;
		color: CategoryColor;
	} | null>(null);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<
		string | null
	>(null);
	const [categoryForm, setCategoryForm] = useState({
		name: "",
		color: "blue" as CategoryColor,
	});
	const [error, setError] = useState("");

	// tRPC hooks
	const {
		data: categories,
		isLoading: categoriesLoading,
		refetch: refetchCategories,
	} = api.categories.getAll.useQuery();

	const createCategoryMutation = api.categories.create.useMutation();
	const updateCategoryMutation = api.categories.update.useMutation();
	const deleteCategoryMutation = api.categories.delete.useMutation();

	const handleAddCategory = () => {
		setEditingCategory(null);
		setCategoryForm({ name: "", color: "blue" });
		setShowCategoryDialog(true);
	};

	const handleEditCategory = (category: {
		id: string;
		name: string;
		color: CategoryColor;
	}) => {
		setEditingCategory(category);
		setCategoryForm({ name: category.name, color: category.color });
		setShowCategoryDialog(true);
	};

	const handleSaveCategory = async () => {
		if (!categoryForm.name.trim()) {
			setError("Category name is required");
			return;
		}

		try {
			if (editingCategory) {
				if (!editingCategory.id) {
					setError("Category ID is missing");
					return;
				}
				await updateCategoryMutation.mutateAsync({
					id: editingCategory.id,
					name: categoryForm.name.trim(),
					color: categoryForm.color,
				});
				toast.success("Category updated");
			} else {
				await createCategoryMutation.mutateAsync({
					name: categoryForm.name.trim(),
					color: categoryForm.color,
				});
				toast.success("Category created");
			}
			setShowCategoryDialog(false);
			refetchCategories();
			setError("");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to save category";
			setError(errMsg);
			toast.error(errMsg);
		}
	};

	const handleDeleteCategory = (categoryId: string) => {
		setPendingDeleteCategoryId(categoryId);
		setShowDeleteDialog(true);
	};

	const confirmDeleteCategory = async () => {
		if (!pendingDeleteCategoryId) return;
		try {
			await deleteCategoryMutation.mutateAsync({ id: pendingDeleteCategoryId });
			refetchCategories();
			toast.success("Category deleted");
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to delete category";
			setError(errMsg);
			toast.error(errMsg);
		} finally {
			setShowDeleteDialog(false);
			setPendingDeleteCategoryId(null);
		}
	};

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Categories</CardTitle>
							<CardDescription>
								Manage your expense categories. Categories help you organize and
								track your spending.
							</CardDescription>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row">
							<Button
								onClick={() => setShowCategoryList(!showCategoryList)}
								size="sm"
								variant="outline"
							>
								{showCategoryList ? (
									<ChevronUp className="mr-2 h-4 w-4" />
								) : (
									<ChevronDown className="mr-2 h-4 w-4" />
								)}
								{showCategoryList ? "Hide" : "Show"} Category List
							</Button>
							<Button onClick={handleAddCategory} size="sm">
								<IconPlus className="mr-2 h-4 w-4" />
								Add Category
							</Button>
						</div>
					</div>
				</CardHeader>
				{showCategoryList && (
					<CardContent>
						{categoriesLoading ? (
							<div className="text-center">Loading categories...</div>
						) : categories?.length === 0 ? (
							<div className="text-center text-muted-foreground">
								No categories yet. Add your first category to get started.
							</div>
						) : categories ? (
							<div className="grid gap-3">
								{categories.map((category) => (
									<div
										className="flex items-center justify-between rounded-lg border p-3"
										key={category.id}
									>
										<div className="flex items-center gap-3">
											<div
												className={cn(
													"h-4 w-4 rounded-full",
													CATEGORY_COLOR_MAP[
														category.color as keyof typeof CATEGORY_COLOR_MAP
													]?.split(" ")[0] || "bg-gray-400",
												)}
											/>
											<span className="font-medium">{category.name}</span>
											<Badge className="text-xs" variant="secondary">
												{category.color}
											</Badge>
										</div>
										<div className="flex gap-2">
											<Button
												onClick={() =>
													handleEditCategory({
														...category,
														color: category.color as CategoryColor,
													})
												}
												size="sm"
												variant="ghost"
											>
												<IconEdit className="h-4 w-4" />
											</Button>
											<Button
												className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
												onClick={() => handleDeleteCategory(category.id)}
												size="sm"
												variant="ghost"
											>
												<IconTrash className="h-4 w-4" />
											</Button>
										</div>
									</div>
								))}
							</div>
						) : null}
					</CardContent>
				)}
			</Card>

			{/* Category Dialog */}
			<Dialog onOpenChange={setShowCategoryDialog} open={showCategoryDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{editingCategory ? "Edit Category" : "Add Category"}
						</DialogTitle>
						<DialogDescription>
							{editingCategory
								? "Update the category name and color."
								: "Create a new category to organize your expenses."}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="categoryName">Category Name</Label>
							<Input
								id="categoryName"
								onChange={(e) =>
									setCategoryForm((prev) => ({ ...prev, name: e.target.value }))
								}
								placeholder="e.g., Groceries, Transport, Dining"
								value={categoryForm.name}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="categoryColor">Color</Label>
							<Select
								onValueChange={(value) =>
									setCategoryForm((prev) => ({
										...prev,
										color: value as CategoryColor,
									}))
								}
								value={categoryForm.color}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CATEGORY_COLORS.map((color) => (
										<SelectItem key={color} value={color}>
											<div className="flex items-center gap-2">
												<div
													className={cn(
														"h-3 w-3 rounded-full",
														CATEGORY_COLOR_MAP[color]?.split(" ")[0] ||
															"bg-gray-400",
													)}
												/>
												<span className="capitalize">{color}</span>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{error && (
							<div className="text-red-600 text-sm dark:text-red-400">
								{error}
							</div>
						)}
					</div>
					<DialogFooter>
						<Button
							disabled={
								createCategoryMutation.isPending ||
								updateCategoryMutation.isPending
							}
							onClick={() => setShowCategoryDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={
								createCategoryMutation.isPending ||
								updateCategoryMutation.isPending
							}
							onClick={handleSaveCategory}
						>
							{createCategoryMutation.isPending ||
							updateCategoryMutation.isPending
								? "Saving..."
								: editingCategory
									? "Update Category"
									: "Add Category"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete category</DialogTitle>
						<DialogDescription>
							This cannot be undone. Expenses using this category will be left
							uncategorized.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteCategoryMutation.isPending}
							onClick={() => {
								setShowDeleteDialog(false);
								setPendingDeleteCategoryId(null);
							}}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteCategoryMutation.isPending}
							onClick={confirmDeleteCategory}
							variant="destructive"
						>
							{deleteCategoryMutation.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

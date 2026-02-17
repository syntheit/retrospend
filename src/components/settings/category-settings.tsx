"use client";

import { ChevronRight, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
// import { AddCategoryCard } from "~/components/settings/category-card";
import {
	CategoryFormDialog,
	type CategoryFormValues,
} from "~/components/settings/category-form-dialog";
import { CategoryManagerDialog } from "~/components/settings/category-manager-dialog";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { getCategoryIcon, getCategoryIconName } from "~/lib/category-icons";
import type { CategoryColor } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export function CategorySettings() {
	// Manager Modal state
	const [isManagerOpen, setIsManagerOpen] = useState(false);

	// Edit/Create Dialog state
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState<{
		id?: string;
		name: string;
		color: CategoryColor;
		icon?: string | null;
	} | null>(null);

	// Delete state
	const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);

	// tRPC hooks
	const {
		data: categories,
		isLoading: categoriesLoading,
		refetch: refetchCategories,
	} = api.categories.getAll.useQuery();

	const createCategoryMutation = api.categories.create.useMutation();
	const updateCategoryMutation = api.categories.update.useMutation();
	const deleteCategoryMutation = api.categories.delete.useMutation();

	// Handlers
	const handleAddCategory = () => {
		setEditingCategory(null);
		setIsFormOpen(true);
	};

	const handleEditCategory = (category: {
		id: string;
		name: string;
		color: CategoryColor;
		icon?: string | null;
	}) => {
		setEditingCategory(category);
		setIsFormOpen(true);
	};

	const handleSaveCategory = async (values: CategoryFormValues) => {
		try {
			if (editingCategory?.id) {
				await updateCategoryMutation.mutateAsync({
					id: editingCategory.id,
					name: values.name.trim(),
					color: values.color as CategoryColor,
					icon: values.icon,
				});
				toast.success("Category updated");
			} else {
				await createCategoryMutation.mutateAsync({
					name: values.name.trim(),
					color: values.color as CategoryColor,
					icon: values.icon,
				});
				toast.success("Category created");
			}
			setIsFormOpen(false);
			await refetchCategories();
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to save category";
			toast.error(errMsg);
		}
	};

	const confirmDeleteCategory = async () => {
		if (!categoryToDelete) return;
		try {
			await deleteCategoryMutation.mutateAsync({ id: categoryToDelete });
			await refetchCategories();
			toast.success("Category deleted");
			setIsFormOpen(false); // Close edit dialog
		} catch (err) {
			const errMsg =
				err instanceof Error ? err.message : "Failed to delete category";
			toast.error(errMsg);
		} finally {
			setCategoryToDelete(null);
		}
	};

	const handleDeleteClick = () => {
		if (editingCategory?.id) {
			setCategoryToDelete(editingCategory.id);
		}
	};

	// Preview Stack Logic
	const previewCategories = categories?.slice(0, 5) ?? [];

	return (
		<>
			{/* Launchpad Card */}
			<Card className="group relative overflow-hidden border-border/50 shadow-sm transition-all hover:border-primary/20">
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-primary/5 opacity-0 transition-opacity group-hover:opacity-100"
				/>
				<CardHeader className="flex flex-row items-start justify-between pb-2">
					<div className="flex flex-col gap-1">
						<CardTitle className="flex items-center gap-2 font-semibold text-lg">
							<Settings2 className="h-4 w-4 text-muted-foreground" />
							Categories
						</CardTitle>
						<CardDescription className="text-sm">
							Manage your expense labels and icons.
						</CardDescription>
					</div>
					<Button
						className="z-10 h-8 gap-1.5 font-medium text-xs"
						onClick={() => setIsManagerOpen(true)}
						size="sm"
						variant="secondary"
					>
						Manage
						<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
					</Button>
				</CardHeader>
				<CardContent>
					{/* Category Preview Stack - Overlapping Avatars Effect */}
					<div className="flex items-center pt-2">
						{categoriesLoading ? (
							<div className="flex -space-x-3">
								{[1, 2, 3].map((i) => (
									<div
										className="h-9 w-9 animate-pulse rounded-full bg-muted ring-2 ring-background"
										key={i}
									/>
								))}
							</div>
						) : (
							<div className="-ml-1 flex items-center -space-x-3 p-1 transition-all duration-300 ease-out group-hover:space-x-1">
								{previewCategories.map((category) => {
									const Icon = getCategoryIcon(category.name, category.icon);
									return (
										<div
											className={cn(
												"relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background shadow-sm ring-1 ring-border/50 transition-all hover:z-10 hover:scale-110",
												`bg-${category.color}-500/10 text-${category.color}-500`,
											)}
											key={category.id}
											title={category.name}
										>
											<Icon className="h-4 w-4" />
										</div>
									);
								})}
								{categories && categories.length > 5 && (
									<div className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-muted font-bold text-[10px] text-muted-foreground ring-1 ring-border/50">
										+{categories.length - 5}
									</div>
								)}
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Manager Modal */}
			<CategoryManagerDialog
				categories={categories?.map((c) => ({
					...c,
					color: c.color as string,
					icon: c.icon,
				}))}
				isLoading={categoriesLoading}
				onAddCategory={handleAddCategory}
				onEditCategory={handleEditCategory}
				onOpenChange={setIsManagerOpen}
				open={isManagerOpen}
			/>

			{/* Edit/Create Modal (Nested on top of Manager) */}
			<CategoryFormDialog
				defaultValues={
					editingCategory
						? {
								name: editingCategory.name,
								color: editingCategory.color,
								icon:
									editingCategory.icon ||
									getCategoryIconName(editingCategory.name),
							}
						: undefined
				}
				isSubmitting={
					createCategoryMutation.isPending || updateCategoryMutation.isPending
				}
				mode={editingCategory ? "edit" : "create"}
				onDelete={editingCategory?.id ? handleDeleteClick : undefined}
				onOpenChange={setIsFormOpen}
				onSubmit={handleSaveCategory}
				open={isFormOpen}
			/>

			<ConfirmDialog
				confirmText="Delete"
				description="This cannot be undone. Expenses using this category will be left uncategorized."
				isLoading={deleteCategoryMutation.isPending}
				onConfirm={confirmDeleteCategory}
				onOpenChange={(open) => {
					if (!open) setCategoryToDelete(null);
				}}
				open={!!categoryToDelete}
				title="Delete category"
				variant="destructive"
			/>
		</>
	);
}

"use client";

import { Plus } from "lucide-react";
import {
	AddCategoryCard,
	CategoryCard,
} from "~/components/settings/category-card";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import type { CategoryColor } from "~/lib/constants";

interface Category {
	id: string;
	name: string;
	color: string;
	icon?: string | null;
}

interface CategoryManagerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	categories?: Category[];
	isLoading: boolean;
	onEditCategory: (category: {
		id: string;
		name: string;
		color: CategoryColor;
		icon?: string | null;
	}) => void;
	onAddCategory: () => void;
}

export function CategoryManagerDialog({
	open,
	onOpenChange,
	categories,
	isLoading,
	onEditCategory,
	onAddCategory,
}: CategoryManagerDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
				<DialogHeader className="border-b p-6 pb-4">
					<div className="flex items-center justify-between">
						<div>
							<DialogTitle>Category Manager</DialogTitle>
							<DialogDescription>
								Create, edit, and organize your expense categories.
							</DialogDescription>
						</div>
						<Button className="gap-2" onClick={onAddCategory} size="sm">
							<Plus className="h-4 w-4" />
							Add Category
						</Button>
					</div>
				</DialogHeader>

				<ScrollArea className="flex-1 p-6">
					{isLoading ? (
						<div className="py-12 text-center text-muted-foreground">
							Loading categories...
						</div>
					) : (
						<div className="grid grid-cols-3 gap-4 pb-6 sm:grid-cols-4 md:grid-cols-5">
							{categories?.map((category) => (
								<CategoryCard
									color={category.color as CategoryColor}
									icon={category.icon}
									id={category.id}
									key={category.id}
									name={category.name}
									onClick={() =>
										onEditCategory({
											...category,
											color: category.color as CategoryColor,
											icon: category.icon,
										})
									}
								/>
							))}
							<AddCategoryCard onClick={onAddCategory} />
						</div>
					)}
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}

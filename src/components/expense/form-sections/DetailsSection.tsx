"use client";

import { useFormContext } from "react-hook-form";
import { CategoryPicker } from "~/components/category-picker";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import type { RouterOutputs } from "~/trpc/react";

interface DetailsSectionProps {
	categories: RouterOutputs["categories"]["getAll"] | undefined;
	onTitleChange?: (title: string) => void;
	handleTitleBlur: () => void;
}

export function DetailsSection({
	categories,
	onTitleChange,
	handleTitleBlur,
}: DetailsSectionProps) {
	const {
		register,
		watch,
		setValue,
		formState: { errors },
	} = useFormContext<ExpenseFormData>();

	const watchedCategoryId = watch("categoryId");

	return (
		<div className="space-y-4 sm:space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
				<div className="flex-1 space-y-2">
					<Label htmlFor="title">Expense Title</Label>
					<Input
						id="title"
						{...register("title", {
							onChange: (e) => onTitleChange?.(e.target.value),
							onBlur: handleTitleBlur,
						})}
						placeholder="Enter expense title"
					/>
					{errors.title && (
						<p className="text-red-500 text-sm">{errors.title.message}</p>
					)}
				</div>

				<div className="w-full space-y-2 sm:w-64">
					<Label>Category</Label>
					<CategoryPicker
						categories={categories}
						onValueChange={(value) =>
							setValue("categoryId", value, { shouldDirty: true })
						}
						placeholder="Select a category"
						value={watchedCategoryId}
					/>
					{errors.categoryId && (
						<p className="text-red-500 text-sm">{errors.categoryId.message}</p>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="description">Description (Optional)</Label>
					<Input
						id="description"
						{...register("description")}
						placeholder="Additional details about the expense"
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="location">Location (Optional)</Label>
					<Input
						id="location"
						{...register("location")}
						placeholder="Where was the expense made?"
					/>
				</div>
			</div>
		</div>
	);
}

"use client";

import { useFormContext } from "react-hook-form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import type { RouterOutputs } from "~/trpc/react";
import { CategoryChipSelector } from "./CategoryChipSelector";
import { DateQuickSelect } from "./DateQuickSelect";

interface DetailsSectionProps {
	categories: RouterOutputs["categories"]["getAll"] | undefined;
	onTitleChange?: (title: string) => void;
	handleTitleChange: (title: string) => void;
	handleCategoryChange: (value: string) => void;
	categoryAutoSuggested?: boolean;
}

export function DetailsSection({
	categories,
	onTitleChange,
	handleTitleChange,
	handleCategoryChange,
	categoryAutoSuggested,
}: DetailsSectionProps) {
	const {
		register,
		watch,
		setValue,
		formState: { errors },
	} = useFormContext<ExpenseFormData>();

	const watchedCategoryId = watch("categoryId");

	return (
		<div className="space-y-3">
			{/* Title - full width */}
			<div className="space-y-2">
				<Label htmlFor="title">Expense Title</Label>
				<Input
					id="title"
					{...register("title", {
						onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
							const value = e.target.value;
							onTitleChange?.(value);
							handleTitleChange(value);
						},
					})}
					placeholder="Enter expense title"
					autoComplete="off"
					data-1p-ignore
					data-lpignore="true"
				/>
				{errors.title && (
					<p className="text-destructive text-sm">{errors.title.message}</p>
				)}
			</div>

			{/* Category - full width chip row */}
			<div className="space-y-2">
				<Label>Category</Label>
				<CategoryChipSelector
					categories={categories}
					value={watchedCategoryId}
					onValueChange={handleCategoryChange}
					autoSuggested={categoryAutoSuggested}
				/>
				{errors.categoryId && (
					<p className="text-destructive text-sm">{errors.categoryId.message}</p>
				)}
			</div>

			{/* Date - full width with quick-select chips */}
			<div className="space-y-2">
				<Label>Date</Label>
				<DateQuickSelect
					date={watch("date")}
					onSelect={(date) =>
						setValue("date", date, { shouldDirty: true })
					}
				/>
				{errors.date && (
					<p className="text-destructive text-sm">{errors.date.message}</p>
				)}
			</div>
		</div>
	);
}

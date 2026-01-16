"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface CategoryPickerProps {
	value?: string;
	onValueChange?: (value: string) => void;
	placeholder?: string;
	className?: string;
	categories?: Array<{
		id: string;
		name: string;
		color: string;
	}>;
}

export function CategoryPicker({
	value,
	onValueChange,
	placeholder = "Select category",
	className,
	categories: propCategories,
}: CategoryPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const { data: fetchedCategories, isLoading } =
		api.user.listCategories.useQuery(undefined, { enabled: !propCategories });

	const categories = propCategories || fetchedCategories;

	const filteredCategories = useMemo(() => {
		if (!categories || !search) return categories || [];

		const searchLower = search.toLowerCase();
		return categories.filter((category) =>
			category.name.toLowerCase().includes(searchLower),
		);
	}, [categories, search]);

	const selectedCategory = value && categories?.find((cat) => cat.id === value);

	if (isLoading) {
		return (
			<div
				className={cn(
					"h-9 w-full animate-pulse rounded-md bg-muted",
					className,
				)}
			/>
		);
	}

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-expanded={open}
					className={cn("w-64 justify-between", className)}
					role="combobox"
					variant="outline"
				>
					{selectedCategory ? (
						<span className="flex min-w-0 flex-1 items-center gap-2">
							<div
								className={cn(
									"h-3 w-3 rounded-full",
									CATEGORY_COLOR_MAP[
										selectedCategory.color as keyof typeof CATEGORY_COLOR_MAP
									]?.split(" ")[0] || "bg-gray-400",
								)}
							/>
							<span className="truncate">{selectedCategory.name}</span>
						</span>
					) : (
						placeholder
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64 p-0">
				<div className="p-2">
					<Input
						className="mb-2"
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search categories..."
						value={search}
					/>
				</div>
				<div
					className="max-h-64 overflow-y-auto"
					onWheel={(e) => {
						e.stopPropagation();
					}}
				>
					{filteredCategories.length === 0 ? (
						<div className="p-4 text-center text-muted-foreground">
							No categories found.
						</div>
					) : (
						filteredCategories.map((category) => (
							<Button
								className={cn(
									"h-auto w-full justify-start gap-2 px-3 py-2",
									value === category.id && "bg-accent text-accent-foreground",
								)}
								key={category.id}
								onClick={() => {
									onValueChange?.(category.id);
									setOpen(false);
									setSearch("");
								}}
								variant="ghost"
							>
								<Check
									className={cn(
										"h-4 w-4",
										value === category.id ? "opacity-100" : "opacity-0",
									)}
								/>
								<div className="flex items-center gap-2">
									<div
										className={cn(
											"h-3 w-3 rounded-full",
											CATEGORY_COLOR_MAP[
												category.color as keyof typeof CATEGORY_COLOR_MAP
											]?.split(" ")[0] || "bg-gray-400",
										)}
									/>
									<span className="truncate">{category.name}</span>
								</div>
							</Button>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

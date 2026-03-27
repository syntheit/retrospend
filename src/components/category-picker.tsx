"use client";

import { ChevronsUpDown } from "lucide-react";
import { createElement, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { getCategoryIcon } from "~/lib/category-icons";
import { getCategoryColorClasses } from "~/lib/constants";
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
		icon?: string | null;
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

	const { data: fetchedCategories, isLoading } = api.categories.getAll.useQuery(
		undefined,
		{ enabled: !propCategories },
	);

	const categories:
		| Array<{ id: string; name: string; color: string; icon?: string | null }>
		| undefined = propCategories || fetchedCategories;

	const filteredCategories = useMemo(() => {
		const list = categories ?? [];
		const searchLower = search.toLowerCase();
		const filtered = search
			? list.filter((category) =>
					category.name.toLowerCase().includes(searchLower),
				)
			: list;
		if (!value) return filtered;
		return [...filtered].sort((a, b) =>
			a.id === value ? -1 : b.id === value ? 1 : 0,
		);
	}, [categories, search, value]);

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
		<Popover onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setSearch(""); }} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-expanded={open}
					aria-label="Select category"
					className={cn("w-full justify-between sm:w-64", className)}
					role="combobox"
					variant="outline"
				>
					{selectedCategory ? (
						<span className="flex min-w-0 flex-1 items-center gap-2">
							<span
								className={cn(
									"flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
									getCategoryColorClasses(selectedCategory.color, "light"),
								)}
							>
								{createElement(
									getCategoryIcon(selectedCategory.name, selectedCategory.icon),
									{ className: "h-3 w-3" },
								)}
							</span>
							<span className="truncate">{selectedCategory.name}</span>
						</span>
					) : (
						placeholder
					)}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[var(--radix-popover-trigger-width)] p-0"
			>
				<div className="p-2">
					<Input
						className="mb-2"
						onChange={(e) => setSearch(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && filteredCategories.length === 1) {
								onValueChange?.(filteredCategories[0]!.id);
								setOpen(false);
								setSearch("");
							}
						}}
						placeholder="Search categories..."
						value={search}
					/>
				</div>
				<div
					className="max-h-64 overflow-y-auto overscroll-contain"
					onTouchMove={(e) => e.stopPropagation()}
					onWheel={(e) => e.stopPropagation()}
				>
					<div className="flex flex-col p-1">
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
									<span
										className={cn(
											"flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
											getCategoryColorClasses(category.color, "light"),
										)}
									>
										{createElement(
											getCategoryIcon(category.name, category.icon),
											{ className: "h-3.5 w-3.5" },
										)}
									</span>
									<span className="truncate">{category.name}</span>
								</Button>
							))
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

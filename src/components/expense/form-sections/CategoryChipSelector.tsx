"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, EyeOff, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { CATEGORY_COLORS, getCategoryColorClasses } from "~/lib/constants";
import { getCategoryIcon } from "~/lib/category-icons";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";

interface Category {
	id: string;
	name: string;
	color: string;
	icon?: string | null;
	excludeByDefault?: boolean;
}

interface CategoryChipSelectorProps {
	categories: Category[] | undefined;
	value?: string;
	onValueChange: (value: string) => void;
	autoSuggested?: boolean;
}

export function CategoryChipSelector({
	categories,
	value,
	onValueChange,
	autoSuggested,
}: CategoryChipSelectorProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrollTarget = useRef(0);
	const scrollRaf = useRef<number>(0);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [showFade, setShowFade] = useState(false);
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [creating, setCreating] = useState(false);
	const [newCategoryName, setNewCategoryName] = useState("");
	const newCategoryInputRef = useRef<HTMLInputElement>(null);

	const utils = api.useUtils();
	const createMutation = api.categories.create.useMutation({
		onSuccess: async (newCat) => {
			await utils.categories.getAll.invalidate();
			onValueChange(newCat.id);
			setCreating(false);
			setNewCategoryName("");
			setSearch("");
			setPopoverOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	// Scroll-aware fade
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const checkFade = () => {
			setShowFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
		};

		checkFade();
		el.addEventListener("scroll", checkFade);
		const observer = new ResizeObserver(checkFade);
		observer.observe(el);

		return () => {
			el.removeEventListener("scroll", checkFade);
			observer.disconnect();
		};
	}, [categories]);

	// Focus new category input when inline form appears
	useEffect(() => {
		if (creating) {
			const timer = setTimeout(
				() => newCategoryInputRef.current?.focus(),
				50,
			);
			return () => clearTimeout(timer);
		}
	}, [creating]);

	const handleWheel = useCallback((e: React.WheelEvent) => {
		if (!e.shiftKey) return;
		const el = scrollRef.current;
		if (!el) return;
		e.preventDefault();
		scrollTarget.current = Math.max(
			0,
			Math.min(
				el.scrollWidth - el.clientWidth,
				(scrollRaf.current ? scrollTarget.current : el.scrollLeft) + e.deltaY,
			),
		);
		if (scrollRaf.current) return;
		const animate = () => {
			const current = el.scrollLeft;
			const target = scrollTarget.current;
			const diff = target - current;
			if (Math.abs(diff) < 0.5) {
				el.scrollLeft = target;
				scrollRaf.current = 0;
				return;
			}
			el.scrollLeft = current + diff * 0.25;
			scrollRaf.current = requestAnimationFrame(animate);
		};
		scrollRaf.current = requestAnimationFrame(animate);
	}, []);

	const sortedCategories = useMemo(() => {
		if (!categories) return categories;
		if (!value) return categories;
		return [...categories].sort((a, b) =>
			a.id === value ? -1 : b.id === value ? 1 : 0,
		);
	}, [categories, value]);

	if (!categories) {
		return (
			<div className="flex gap-2">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						key={i}
						className="h-8 w-20 animate-pulse rounded-full bg-muted"
					/>
				))}
			</div>
		);
	}

	if (categories.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No categories yet.{" "}
				<a
					className="text-primary underline underline-offset-4"
					href="/settings"
				>
					Add them in Settings
				</a>
				.
			</p>
		);
	}

	const filtered = search
		? (sortedCategories ?? []).filter((c) =>
				c.name.toLowerCase().includes(search.toLowerCase()),
			)
		: (sortedCategories ?? []);

	const getNextColor = () => {
		const usedColors = new Set(categories.map((c) => c.color));
		return CATEGORY_COLORS.find((c) => !usedColors.has(c)) ?? CATEGORY_COLORS[0]!;
	};

	const handleCreate = () => {
		if (!newCategoryName.trim() || createMutation.isPending) return;
		createMutation.mutate({
			name: newCategoryName.trim(),
			color: getNextColor(),
		});
	};

	return (
		<div className="flex items-center gap-1">
			{/* Scrollable chip row */}
			<div className="relative min-w-0 flex-1">
				<div
					ref={scrollRef}
					className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					onWheel={handleWheel}
				>
					{(sortedCategories ?? []).map((category) => {
						const isSelected = value === category.id;
						return (
							<button
								key={category.id}
								type="button"
								title={category.excludeByDefault ? `${category.name} (excluded from analytics by default)` : category.name}
								onClick={() =>
									onValueChange(isSelected ? "" : category.id)
								}
								className={cn(
									"relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-300",
									isSelected
										? getCategoryColorClasses(category.color, "accentSelected")
										: "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
									isSelected && autoSuggested && "ring-2 ring-primary/40",
								)}
							>
								<span
									className={cn(
										"flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full",
										getCategoryColorClasses(category.color, "accent"),
									)}
								>
									{createElement(
										getCategoryIcon(category.name, category.icon),
										{ className: "h-2.5 w-2.5" },
									)}
								</span>
								<span className="max-w-[5rem] truncate">
									{category.name}
								</span>
								{category.excludeByDefault && (
									<EyeOff className="h-2.5 w-2.5 shrink-0 opacity-40" />
								)}
							</button>
						);
					})}
				</div>
				{/* Scroll-aware right-edge fade */}
				{showFade && (
					<div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
				)}
			</div>

			{/* "+" chip - always visible, opens full category list + create */}
			<Popover
				open={popoverOpen}
				onOpenChange={(o) => {
					setPopoverOpen(o);
					if (!o) {
						setSearch("");
						setCreating(false);
						setNewCategoryName("");
					}
				}}
			>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-border px-2 py-1 text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
					>
						<Plus className="h-3 w-3" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					className="w-56 p-0"
					onOpenAutoFocus={(e) => {
						e.preventDefault();
						searchInputRef.current?.focus();
					}}
				>
					{/* Search input */}
					<div className="flex items-center gap-2 border-b px-3 py-2">
						<Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<input
							ref={searchInputRef}
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
							placeholder="Search categories..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Category list */}
					<div
						className="max-h-52 overflow-y-auto overscroll-contain py-1"
						onTouchMove={(e) => e.stopPropagation()}
						onWheel={(e) => e.stopPropagation()}
					>
						{filtered.length === 0 && (
							<p className="px-3 py-3 text-center text-muted-foreground text-xs">
								No categories found
							</p>
						)}
						{filtered.map((category) => {
							const isSelected = value === category.id;
							return (
								<button
									key={category.id}
									type="button"
									onClick={() => {
										onValueChange(isSelected ? "" : category.id);
										setPopoverOpen(false);
										setSearch("");
									}}
									className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
								>
									<span
										className={cn(
											"flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
											getCategoryColorClasses(category.color, "accent"),
										)}
									>
										{createElement(
											getCategoryIcon(category.name, category.icon),
											{ className: "h-3 w-3" },
										)}
									</span>
									<span className="flex-1 truncate text-left">
										{category.name}
									</span>
									{category.excludeByDefault && (
										<EyeOff className="h-3 w-3 shrink-0 text-muted-foreground/40" />
									)}
									{isSelected && (
										<Check className="h-3.5 w-3.5 shrink-0 text-primary" />
									)}
								</button>
							);
						})}
					</div>

					{/* Create new category */}
					<div className="border-t">
						{!creating ? (
							<button
								type="button"
								onClick={() => setCreating(true)}
								className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							>
								<Plus className="h-3.5 w-3.5" />
								Create new category
							</button>
						) : (
							<div className="p-2">
								<input
									ref={newCategoryInputRef}
									className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
									placeholder="Category name..."
									value={newCategoryName}
									onChange={(e) => setNewCategoryName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleCreate();
										} else if (e.key === "Escape") {
											setCreating(false);
											setNewCategoryName("");
										}
									}}
								/>
								<div className="mt-1.5 flex justify-end gap-1">
									<button
										type="button"
										onClick={() => {
											setCreating(false);
											setNewCategoryName("");
										}}
										className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleCreate}
										disabled={
											!newCategoryName.trim() ||
											createMutation.isPending
										}
										className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
									>
										{createMutation.isPending ? "Creating..." : "Create"}
									</button>
								</div>
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

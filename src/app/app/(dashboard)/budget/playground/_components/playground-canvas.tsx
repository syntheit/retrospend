"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import { useCurrency } from "~/hooks/use-currency";
import { PlaygroundBudgetRow } from "./playground-budget-row";
import { usePlayground } from "./playground-context";

export function PlaygroundCanvas() {
	const { categories, simulatedBudgets, isLoading } = usePlayground();
	const { homeCurrency } = useCurrency();
	const [searchQuery, setSearchQuery] = useState("");

	const filteredCategories = useMemo(() => {
		return categories
			.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
			.sort((a, b) => {
				const aHas = (simulatedBudgets[a.id] ?? 0) > 0 ? 1 : 0;
				const bHas = (simulatedBudgets[b.id] ?? 0) > 0 ? 1 : 0;
				if (aHas !== bHas) return bHas - aHas;
				return a.name.localeCompare(b.name);
			});
	}, [categories, searchQuery, simulatedBudgets]);

	const activeCategories = filteredCategories.filter(
		(c) => (simulatedBudgets[c.id] ?? 0) > 0,
	);
	const otherCategories = filteredCategories.filter(
		(c) => (simulatedBudgets[c.id] ?? 0) === 0,
	);

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="relative max-w-md">
				<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="border-stone-200 bg-stone-50 pl-9 focus-visible:ring-indigo-500 dark:border-stone-800 dark:bg-stone-950"
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder="Filter categories..."
					value={searchQuery}
				/>
			</div>

			<div className="space-y-8 pb-32">
				{activeCategories.length > 0 && (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="font-bold text-lg tracking-tight">
								Active Simulations
							</h3>
							<span className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
								{activeCategories.length} categories
							</span>
						</div>
						<div className="grid gap-4">
							{activeCategories.map((cat) => (
								<PlaygroundBudgetRow
									category={cat}
									currency={homeCurrency}
									key={cat.id}
								/>
							))}
						</div>
					</div>
				)}

				{otherCategories.length > 0 && (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="font-bold text-lg text-stone-400 tracking-tight">
								Untouched Categories
							</h3>
							<span className="font-medium text-stone-400 text-xs uppercase tracking-widest">
								{otherCategories.length} available
							</span>
						</div>
						<div className="grid gap-4 opacity-70 transition-opacity hover:opacity-100">
							{otherCategories.map((cat) => (
								<PlaygroundBudgetRow
									category={cat}
									currency={homeCurrency}
									key={cat.id}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

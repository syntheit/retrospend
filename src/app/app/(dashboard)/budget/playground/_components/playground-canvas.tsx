"use client";

import { useMemo } from "react";
import { usePlayground } from "./playground-context";
import { PlaygroundBudgetRow } from "./playground-budget-row";
import { useCurrency } from "~/hooks/use-currency";
import { Search } from "lucide-react";
import { Input } from "~/components/ui/input";
import { useState } from "react";

export function PlaygroundCanvas() {
	const { categories, simulatedBudgets, isLoading } = usePlayground();
	const { homeCurrency } = useCurrency();
    const [searchQuery, setSearchQuery] = useState("");

    const filteredCategories = useMemo(() => {
        return categories.filter((c) => 
            c.name.toLowerCase().includes(searchQuery.toLowerCase())
        ).sort((a, b) => {
            const aHas = (simulatedBudgets[a.id] ?? 0) > 0 ? 1 : 0;
            const bHas = (simulatedBudgets[b.id] ?? 0) > 0 ? 1 : 0;
            if (aHas !== bHas) return bHas - aHas;
            return a.name.localeCompare(b.name);
        });
    }, [categories, searchQuery, simulatedBudgets]);

    const activeCategories = filteredCategories.filter((c) => (simulatedBudgets[c.id] ?? 0) > 0);
    const otherCategories = filteredCategories.filter((c) => (simulatedBudgets[c.id] ?? 0) === 0);

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
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                    placeholder="Filter categories..." 
                    className="pl-9 bg-stone-50 border-stone-200 focus-visible:ring-indigo-500 dark:bg-stone-950 dark:border-stone-800"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            <div className="space-y-8 pb-32">
                {activeCategories.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold tracking-tight">Active Simulations</h3>
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{activeCategories.length} categories</span>
                        </div>
                        <div className="grid gap-4">
                            {activeCategories.map((cat) => (
                                <PlaygroundBudgetRow 
                                    key={cat.id} 
                                    category={cat} 
                                    currency={homeCurrency} 
                                />
                            ))}
                        </div>
                    </div>
                )}

                {otherCategories.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold tracking-tight text-stone-400">Untouched Categories</h3>
                             <span className="text-xs font-medium text-stone-400 uppercase tracking-widest">{otherCategories.length} available</span>
                        </div>
                        <div className="grid gap-4 opacity-70 transition-opacity hover:opacity-100">
                            {otherCategories.map((cat) => (
                                <PlaygroundBudgetRow 
                                    key={cat.id} 
                                    category={cat} 
                                    currency={homeCurrency} 
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
		</div>
	);
}

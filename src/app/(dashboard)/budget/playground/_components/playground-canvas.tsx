"use client";

import { LayoutGrid, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrency } from "~/hooks/use-currency";
import { PlaygroundBudgetRow } from "./playground-budget-row";
import { usePlayground } from "./playground-context";

export function PlaygroundCanvas() {
	const t = useTranslations("playground");
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
			<div className="space-y-6">
				<Skeleton className="h-10 w-full max-w-md rounded-lg" />
				<div className="space-y-4">
					<Skeleton className="h-5 w-40" />
					<div className="grid gap-4">
						<Skeleton className="h-[72px] w-full rounded-xl" />
						<Skeleton className="h-[72px] w-full rounded-xl" />
						<Skeleton className="h-[72px] w-full rounded-xl" />
					</div>
				</div>
			</div>
		);
	}

	if (categories.length === 0) {
		return (
			<EmptyState
				action={{ label: t("goToSettings"), href: "/settings" }}
				description={t("createCategoriesFirst")}
				icon={LayoutGrid}
				title={t("noCategoriesYet")}
			/>
		);
	}

	return (
		<div className="space-y-6">
			<div className="relative max-w-md">
				<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="pl-9"
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder={t("filterCategories")}
					value={searchQuery}
				/>
			</div>

			<div className="space-y-8 pb-32">
				{activeCategories.length > 0 && (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="font-bold text-lg tracking-tight">
								{t("activeSimulations")}
							</h3>
							<span className="font-medium text-muted-foreground text-xs tracking-wide">
								{activeCategories.length} {t("categories")}
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
							<h3 className="font-bold text-lg text-muted-foreground tracking-tight">
								{t("untouchedCategories")}
							</h3>
							<span className="font-medium text-muted-foreground text-xs tracking-wide">
								{otherCategories.length} {t("available")}
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

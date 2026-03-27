"use client";

import { Card, CardContent } from "~/components/ui/card";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { COLOR_TO_HEX } from "~/lib/constants";

interface CategoryStat {
	categoryId: string | null;
	name: string;
	color: string;
	total: number;
	count: number;
}

interface CategoriesCardProps {
	categories: CategoryStat[];
	total: number;
	currency: string;
}

const DEFAULT_COLORS = [
	"#10b981",
	"#3b82f6",
	"#f59e0b",
	"#ef4444",
	"#8b5cf6",
	"#06b6d4",
	"#ec4899",
	"#84cc16",
	"#f97316",
	"#6366f1",
];

export function CategoriesCard({
	categories,
	total,
	currency,
}: CategoriesCardProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const categoryData = categories.map((cat, i) => ({
		...cat,
		fill:
			COLOR_TO_HEX[cat.color] ??
			DEFAULT_COLORS[i % DEFAULT_COLORS.length] ??
			"#10b981",
	}));

	return (
		<Card className="h-full border border-border bg-card shadow-sm">
			<CardContent className="p-4 sm:p-5">
				{/* Header */}
				<div className="mb-3 flex items-center justify-between">
					<span className="text-xs font-medium tracking-wide text-muted-foreground">
						Spending by Category
					</span>
					<span className="text-lg font-bold tabular-nums">
						{formatCurrency(total, currency)}
					</span>
				</div>

				{categories.length === 0 ? (
					<div className="flex h-16 items-center justify-center">
						<p className="text-sm text-muted-foreground">No expenses yet</p>
					</div>
				) : (
					<>
						{/* Stacked bar */}
						<div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div className="flex h-full">
								{categoryData.map((cat) => (
									<div
										key={cat.categoryId ?? cat.name}
										style={{
											width: `${total > 0 ? (cat.total / total) * 100 : 0}%`,
											backgroundColor: cat.fill,
										}}
									/>
								))}
							</div>
						</div>

						{/* Category rows */}
						<div className="flex flex-col">
							{categoryData.map((cat) => {
								const pct =
									total > 0
										? ((cat.total / total) * 100).toFixed(1)
										: "0";
								return (
									<div
										key={cat.categoryId ?? cat.name}
										className="flex items-center justify-between py-1.5"
									>
										<div className="flex items-center gap-2">
											<div
												className="h-2 w-2 shrink-0 rounded-full"
												style={{ backgroundColor: cat.fill }}
											/>
											<span className="text-sm">{cat.name}</span>
										</div>
										<div className="flex items-center gap-3">
											<span className="text-xs text-muted-foreground tabular-nums">
												{pct}%
											</span>
											<span className="text-sm font-semibold tabular-nums">
												{formatCurrency(cat.total, currency)}
											</span>
										</div>
									</div>
								);
							})}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

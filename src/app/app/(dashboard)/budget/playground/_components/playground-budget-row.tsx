"use client";

import { Input } from "~/components/ui/input";
import { Slider } from "~/components/ui/slider";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { cn, getCurrencySymbol } from "~/lib/utils";
import type { Category } from "~/types/budget-types";
import { usePlayground } from "./playground-context";

interface PlaygroundBudgetRowProps {
	category: Category;
	currency: string;
}

export function PlaygroundBudgetRow({
	category,
	currency,
}: PlaygroundBudgetRowProps) {
	const { simulatedBudgets, updateBudget } = usePlayground();
	const { formatCurrency } = useCurrencyFormatter();

	const amount = simulatedBudgets[category.id] ?? 0;
	const categoryColor =
		CATEGORY_COLOR_MAP[category.color as keyof typeof CATEGORY_COLOR_MAP] ||
		"bg-gray-500";

	const handleSliderChange = (values: number[]) => {
		const val = values[0];
		if (val !== undefined) {
			updateBudget(category.id, val);
		}
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = parseFloat(e.target.value);
		if (!Number.isNaN(val)) {
			updateBudget(category.id, val);
		} else if (e.target.value === "") {
			updateBudget(category.id, 0);
		}
	};

	// Determine a reasonable max for the slider
	// If the amount is small, max 1000. If larger, amount * 2.
	const sliderMax = Math.max(1000, Math.ceil(amount / 500) * 500 * 2);

	return (
		<div className="group relative flex flex-col gap-4 rounded-xl border p-4 transition-all hover:border-indigo-200/50 hover:bg-accent/5 lg:flex-row lg:items-center dark:hover:border-indigo-900/50">
			<div className="flex items-center gap-3 lg:w-48 lg:shrink-0">
				<div
					className={cn(
						"flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold text-white shadow-sm transition-transform group-hover:scale-110",
						categoryColor,
					)}
				>
					{category.name.substring(0, 1).toUpperCase()}
				</div>
				<div className="min-w-0">
					<h4 className="truncate font-semibold text-sm sm:text-base">
						{category.name}
					</h4>
				</div>
			</div>

			<div className="flex flex-1 items-center gap-6">
				<Slider
					className="hidden flex-1 sm:flex"
					max={sliderMax}
					onValueChange={handleSliderChange}
					step={10}
					value={[amount]}
				/>

				<div className="relative w-full sm:w-32 lg:w-40">
					<span className="absolute top-1/2 left-3 -translate-y-1/2 font-mono text-muted-foreground text-sm">
						{getCurrencySymbol(currency)}
					</span>
					<Input
						className="h-10 border-none bg-stone-100 pl-7 font-mono text-lg transition-colors focus-visible:ring-1 focus-visible:ring-indigo-500 dark:bg-stone-900"
						onChange={handleInputChange}
						placeholder="0.00"
						type="number"
						value={amount || ""}
					/>
				</div>
			</div>

			<div className="flex items-center justify-between text-muted-foreground text-xs lg:hidden">
				<span>Quick Tune</span>
				<span>{formatCurrency(amount, currency)}</span>
			</div>
		</div>
	);
}

"use client";

import { Badge } from "~/components/ui/badge";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

interface QuickChipsProps {
	averageSpend: number;
	lastMonthSpend: number;
	homeCurrency: string;
	onChipClick: (value: number) => void;
	disabled?: boolean;
}

export function QuickChips({
	averageSpend,
	lastMonthSpend,
	homeCurrency,
	onChipClick,
	disabled = false,
}: QuickChipsProps) {
	const { formatCurrency } = useCurrencyFormatter();

	const chips = [
		{
			label: `Avg: ${formatCurrency(averageSpend, homeCurrency)}`,
			value: averageSpend,
		},
		{
			label: `Last Mo: ${formatCurrency(lastMonthSpend, homeCurrency)}`,
			value: lastMonthSpend,
		},
	];

	return (
		<div className="flex gap-2">
			{chips.map((chip) => (
				<Badge
					className="cursor-pointer transition-colors hover:bg-accent"
					key={chip.label}
					onClick={() => !disabled && onChipClick(chip.value)}
					variant="outline"
				>
					{chip.label}
				</Badge>
			))}
		</div>
	);
}

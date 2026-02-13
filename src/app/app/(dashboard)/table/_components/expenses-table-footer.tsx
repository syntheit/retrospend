import { TableCell, TableRow } from "~/components/ui/table";
import { formatCurrency } from "~/lib/utils";

interface ExpensesTableFooterProps {
	totalAmount: number;
	count: number;
	currency: string;
	hasForeignCurrencyExpenses?: boolean;
	foreignCurrencySummary?: string | null;
}

/**
 * ExpensesTableFooter - Presentational component for the table's total row.
 */
export function ExpensesTableFooter({
	totalAmount,
	count,
	currency,
	hasForeignCurrencyExpenses,
	foreignCurrencySummary,
}: ExpensesTableFooterProps) {
	return (
		<TableRow className="border-t-2 bg-muted/50 font-semibold">
			<TableCell
				className="px-4 py-3 text-left font-semibold"
				colSpan={4}
			>
				Total ({count} items)
			</TableCell>
			
			{hasForeignCurrencyExpenses && (
				<TableCell className="px-4 py-3 text-right font-semibold">
					{foreignCurrencySummary}
				</TableCell>
			)}

			<TableCell className="px-4 py-3 text-right font-semibold">
				<div className="text-right font-medium">
					{formatCurrency(totalAmount, currency)}
				</div>
			</TableCell>
		</TableRow>
	);
}

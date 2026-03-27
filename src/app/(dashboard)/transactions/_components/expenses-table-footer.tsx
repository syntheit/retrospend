import { TableCell, TableRow } from "~/components/ui/table";
import { formatCurrency } from "~/lib/utils";

interface ExpensesTableFooterProps {
	totalAmount: number;
	/** Amount from excluded-only rows; used to compute the "excl. hidden" figure */
	excludedAmount?: number;
	count: number;
	currency: string;
	hasForeignCurrencyExpenses?: boolean;
	/** True when the "Paid By" column is visible (typeFilter is "all" or "shared") */
	hasPaidByColumn?: boolean;
}

/**
 * ExpensesTableFooter - Presentational component for the table's total row.
 *
 * Column layout mirrors createExpenseColumns exactly:
 *   title, category, date [, paidBy] [, localPrice], basePrice, actions
 * Each footer cell matches its corresponding column - no colSpan on the amount.
 */
export function ExpensesTableFooter({
	totalAmount,
	excludedAmount,
	count,
	currency,
	hasForeignCurrencyExpenses,
	hasPaidByColumn,
}: ExpensesTableFooterProps) {
	const hasExcluded = excludedAmount !== undefined && excludedAmount > 0;
	const includedTotal = hasExcluded ? totalAmount - excludedAmount : totalAmount;

	return (
		<TableRow className="border-t-2 bg-muted/50 font-semibold">
			{/* title column */}
			<TableCell className="text-left font-semibold">Total</TableCell>
			{/* category column */}
			<TableCell />
			{/* date column */}
			<TableCell />
			{/* paidBy column - only present when visible */}
			{hasPaidByColumn && <TableCell />}
			{/* localPrice column - only present when visible */}
			{hasForeignCurrencyExpenses && <TableCell />}
			{/* basePrice column - right-aligned to match body cells */}
			<TableCell className="text-right font-semibold">
				{hasExcluded ? (
					<div className="flex flex-col items-end gap-0.5">
						<span>{formatCurrency(totalAmount, currency)}</span>
						<span className="font-normal text-muted-foreground text-xs">
							{formatCurrency(includedTotal, currency)} excl. hidden
						</span>
					</div>
				) : (
					formatCurrency(totalAmount, currency)
				)}
			</TableCell>
			{/* actions column */}
			<TableCell className="px-4 py-3" />
		</TableRow>
	);
}

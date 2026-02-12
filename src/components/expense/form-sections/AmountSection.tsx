"use client";

import { useFormContext } from "react-hook-form";
import { CurrencyPicker } from "~/components/currency-picker";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import { cn } from "~/lib/utils";

interface AmountSectionProps {
	handleAmountChange: (value: number) => void;
	handleCurrencyChange: (currency: string) => void;
}

export function AmountSection({
	handleAmountChange,
	handleCurrencyChange,
}: AmountSectionProps) {
	const {
		register,
		watch,
		formState: { errors },
	} = useFormContext<ExpenseFormData>();
	const { getCurrencySymbol } = useCurrencyFormatter();
	const watchedCurrency = watch("currency");

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
			<div className="flex-1 space-y-2">
				<Label htmlFor="amount">Amount</Label>
				<div
					className={cn(
						"flex h-auto min-h-[2.25rem] w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
						"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
						errors.amount &&
							"border-destructive focus-within:ring-destructive/20 dark:focus-within:ring-destructive/40",
					)}
				>
					<span className="shrink-0 font-medium text-muted-foreground">
						{getCurrencySymbol(watchedCurrency)}
					</span>
					<Input
						id="amount"
						step="0.01"
						type="number"
						{...register("amount", {
							valueAsNumber: true,
							onChange: (e) => handleAmountChange(Number(e.target.value)),
						})}
						className="h-full w-full grow border-0 bg-transparent px-0 py-0 font-bold text-lg shadow-none focus-visible:ring-0 sm:text-2xl dark:bg-transparent"
						placeholder="0.00"
					/>
				</div>
				{errors.amount && (
					<p className="text-red-500 text-sm">{errors.amount.message}</p>
				)}
			</div>

			<div className="w-full space-y-2 sm:w-72">
				<Label htmlFor="currency">Currency</Label>
				<CurrencyPicker
					onValueChange={handleCurrencyChange}
					placeholder="Select currency"
					value={watchedCurrency}
				/>
				{errors.currency && (
					<p className="text-red-500 text-sm">{errors.currency.message}</p>
				)}
			</div>
		</div>
	);
}

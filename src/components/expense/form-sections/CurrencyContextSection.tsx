"use client";

import { useFormContext } from "react-hook-form";
import { Button } from "~/components/ui/button";
import { DatePicker } from "~/components/ui/date-picker";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RateSelector } from "~/components/ui/rate-selector";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import { CRYPTO_CURRENCIES } from "~/lib/currencies";
import { cn } from "~/lib/utils";

interface CurrencyContextSectionProps {
	homeCurrency: string;
	isCustomRateSet: boolean;
	setIsCustomRateSet: (v: boolean) => void;
	setShowCustomRateDialog: (v: boolean) => void;
	handleExchangeRateChange: (rate: number | undefined, type?: string) => void;
}

export function CurrencyContextSection({
	homeCurrency,
	isCustomRateSet,
	setIsCustomRateSet,
	setShowCustomRateDialog,
	handleExchangeRateChange,
}: CurrencyContextSectionProps) {
	const {
		register,
		watch,
		setValue,
		formState: { errors },
	} = useFormContext<ExpenseFormData>();
	const { getCurrencySymbol } = useCurrencyFormatter();

	const watchedCurrency = watch("currency");
	const watchedDate = watch("date");
	const watchedExchangeRate = watch("exchangeRate");
	const watchedPricingSource = watch("pricingSource");

	const isForeignCurrency = watchedCurrency !== homeCurrency;
	const isCrypto = watchedCurrency in CRYPTO_CURRENCIES;

	if (!isForeignCurrency) {
		return (
			<div className="space-y-2">
				<Label>Date</Label>
				<DatePicker
					date={watchedDate}
					onSelect={(date) =>
						date && setValue("date", date, { shouldDirty: true })
					}
					placeholder="Select date"
				/>
				{errors.date && (
					<p className="text-red-500 text-sm">{errors.date.message}</p>
				)}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
			<div className="space-y-2">
				<Label>Date</Label>
				<DatePicker
					date={watchedDate}
					onSelect={(date) =>
						date && setValue("date", date, { shouldDirty: true })
					}
					placeholder="Select date"
				/>
				{errors.date && (
					<p className="text-red-500 text-sm">{errors.date.message}</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="amountInUSD">Amount in {homeCurrency}</Label>
				<div
					className={cn(
						"flex h-9 w-full items-center gap-2 rounded-md border border-input bg-muted px-3 py-1 shadow-xs",
						errors.amountInUSD && "border-destructive",
					)}
				>
					<span className="shrink-0 font-medium text-muted-foreground">
						{getCurrencySymbol(homeCurrency)}
					</span>
					<Input
						disabled={true}
						id="amountInUSD"
						readOnly={true}
						step="0.01"
						type="number"
						{...register("amountInUSD", { valueAsNumber: true })}
						className="h-full w-full grow cursor-default select-none border-0 bg-transparent px-0 py-0 text-muted-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
						placeholder="0.00"
					/>
				</div>
				{errors.amountInUSD && (
					<p className="text-red-500 text-sm">{errors.amountInUSD.message}</p>
				)}
			</div>

			<div className="space-y-2">
				<Label className="flex flex-wrap items-center">
					<span>Exchange Rate</span>
					{isCrypto && (
						<span className="ml-1 font-normal text-muted-foreground">
							(1 {watchedCurrency} = {homeCurrency})
						</span>
					)}
				</Label>
				<div className="flex gap-2">
					<RateSelector
						activeType={watchedPricingSource}
						currency={watchedCurrency}
						displayMode="default-to-foreign"
						homeCurrency={homeCurrency}
						isCustomSet={isCustomRateSet}
						onCustomCleared={() => setIsCustomRateSet(false)}
						onCustomClick={() => setShowCustomRateDialog(true)}
						onCustomSet={() => setIsCustomRateSet(true)}
						onValueChange={handleExchangeRateChange}
						value={watchedExchangeRate}
						variant="inline"
					/>
					{isCustomRateSet && (
						<Button
							className="h-9 px-3"
							onClick={() => setShowCustomRateDialog(true)}
							type="button"
							variant="outline"
						>
							Edit
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

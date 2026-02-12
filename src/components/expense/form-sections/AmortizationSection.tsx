"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "~/components/ui/label";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import { cn } from "~/lib/utils";

export function AmortizationSection() {
	const { watch, setValue } = useFormContext<ExpenseFormData>();
	const { getCurrencySymbol } = useCurrencyFormatter();

	const watchedCurrency = watch("currency");
	const watchedAmount = watch("amount");
	const watchSpreadOverTime = watch("spreadOverTime");
	const watchAmortizeOver = watch("amortizeOver");

	return (
		<div className="pt-2">
			<div
				className={cn(
					"flex items-center justify-between rounded-lg border border-transparent bg-muted/40 p-3 transition-colors",
					watchSpreadOverTime && "bg-muted/60",
				)}
			>
				<div className="space-y-0.5">
					<Label className="text-base">Spread cost over time</Label>
					<p className="font-normal text-muted-foreground text-xs">
						Split this expense into monthly entries
					</p>
				</div>
				<Switch
					checked={watchSpreadOverTime ?? false}
					onCheckedChange={(v) =>
						setValue("spreadOverTime", v, { shouldDirty: true })
					}
				/>
			</div>

			{watchSpreadOverTime && (
				<div className="fade-in slide-in-from-top-2 mt-4 animate-in space-y-6 px-1">
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<Label>Duration</Label>
							<span className="font-medium text-muted-foreground text-sm">
								{watchAmortizeOver} months
							</span>
						</div>
						<Slider
							className="py-1"
							max={24}
							min={2}
							onValueChange={([v]: number[]) =>
								setValue("amortizeOver", v, { shouldDirty: true })
							}
							step={1}
							value={[watchAmortizeOver ?? 3]}
						/>
						<div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-sm">
							<span className="text-muted-foreground">Monthly payment</span>
							<span className="font-medium text-foreground">
								{watchedAmount && watchAmortizeOver
									? getCurrencySymbol(watchedCurrency) +
										(watchedAmount / watchAmortizeOver).toFixed(2)
									: "$0.00"}{" "}
								/ mo
							</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

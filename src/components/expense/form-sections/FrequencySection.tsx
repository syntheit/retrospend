"use client";

import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import { formatNumber } from "~/lib/currency-format";

const PRESETS = [2, 3, 6, 12, 24] as const;

type FrequencySelection = "one-time" | "2" | "3" | "6" | "12" | "24" | "custom";

function deriveSelection(amortizeOver: number | undefined, spreadOverTime: boolean | undefined): FrequencySelection {
	if (!spreadOverTime || !amortizeOver) return "one-time";
	if ((PRESETS as readonly number[]).includes(amortizeOver)) return String(amortizeOver) as FrequencySelection;
	return "custom";
}

export function FrequencySection({ rightSlot }: { rightSlot?: React.ReactNode }) {
	const { watch, setValue } = useFormContext<ExpenseFormData>();
	const { getCurrencySymbol } = useCurrencyFormatter();

	const watchedCurrency = watch("currency");
	const watchedAmount = watch("amount");
	const watchSpreadOverTime = watch("spreadOverTime");
	const watchAmortizeOver = watch("amortizeOver");

	// Local UI state - decoupled from form so "custom" can persist as a selection
	const [selection, setSelection] = useState<FrequencySelection>(() =>
		deriveSelection(watchAmortizeOver, watchSpreadOverTime),
	);
	const [customMonths, setCustomMonths] = useState<string>(
		selection === "custom" ? String(watchAmortizeOver ?? "") : "",
	);

	// Sync when form resets externally (e.g. edit mode loading expense data)
	useEffect(() => {
		const derived = deriveSelection(watchAmortizeOver, watchSpreadOverTime);
		setSelection(derived);
		if (derived === "custom" && watchAmortizeOver) {
			setCustomMonths(String(watchAmortizeOver));
		}
		// Only re-sync on external resets, not on every keystroke
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [watchSpreadOverTime, watchAmortizeOver === undefined ? undefined : Math.round(watchAmortizeOver)]);

	const handleFrequencyChange = (value: FrequencySelection) => {
		setSelection(value);

		if (value === "one-time") {
			setValue("spreadOverTime", false, { shouldDirty: true });
			setValue("amortizeOver", undefined, { shouldDirty: true });
		} else if (value === "custom") {
			setValue("spreadOverTime", true, { shouldDirty: true });
			const parsed = parseInt(customMonths, 10);
			if (parsed >= 2 && parsed <= 24) {
				setValue("amortizeOver", parsed, { shouldDirty: true });
			} else {
				// Leave amortizeOver undefined until user types a valid number
				setValue("amortizeOver", undefined, { shouldDirty: true });
			}
		} else {
			const months = parseInt(value, 10);
			setValue("spreadOverTime", true, { shouldDirty: true });
			setValue("amortizeOver", months, { shouldDirty: true });
		}
	};

	const handleCustomMonthsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = e.target.value;
		setCustomMonths(raw);
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed >= 2 && parsed <= 24) {
			setValue("amortizeOver", parsed, { shouldDirty: true });
		}
	};

	const effectiveMonths = selection === "custom"
		? (parseInt(customMonths, 10) || undefined)
		: (selection === "one-time" ? undefined : parseInt(selection, 10));

	const monthlyAmount =
		watchedAmount && effectiveMonths && watchSpreadOverTime
			? watchedAmount / effectiveMonths
			: null;

	const currencySymbol = getCurrencySymbol(watchedCurrency);

	return (
		<div className="flex items-center gap-3">
			<Label className="w-20 shrink-0 text-sm" htmlFor="frequency-select">Frequency</Label>
			<div className="flex flex-1 items-center gap-3 overflow-hidden">
				<Select
					onValueChange={(v) => handleFrequencyChange(v as FrequencySelection)}
					value={selection}
				>
					<SelectTrigger className="w-36">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="one-time">One-time</SelectItem>
						<SelectItem value="2">2 months</SelectItem>
						<SelectItem value="3">3 months</SelectItem>
						<SelectItem value="6">6 months</SelectItem>
						<SelectItem value="12">12 months</SelectItem>
						<SelectItem value="24">24 months</SelectItem>
						<SelectItem value="custom">Custom...</SelectItem>
					</SelectContent>
				</Select>

				{selection === "custom" && (
					<div className="flex items-center gap-1.5">
						<Input
							aria-label="Custom number of months"
							className="w-16 text-center"
							max={24}
							min={2}
							onChange={handleCustomMonthsChange}
							placeholder="-"
							type="number"
							value={customMonths}
						/>
						<span className="text-muted-foreground text-sm">months</span>
					</div>
				)}

				{monthlyAmount !== null && (
					<span className="ml-auto text-muted-foreground text-sm">
						{currencySymbol}{formatNumber(monthlyAmount, 2)}/mo
					</span>
				)}
			</div>
			{rightSlot}
		</div>
	);
}

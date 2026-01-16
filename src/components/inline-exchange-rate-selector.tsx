"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import { cn } from "~/lib/utils";

interface InlineExchangeRateSelectorProps {
	currency: string;
	homeCurrency: string;
	value?: number;
	mode?: boolean;
	isCustomSet?: boolean;
	onValueChange: (value: number | undefined, type?: string) => void;
	onCustomSelected: () => void;
	onCustomSet?: () => void;
	onCustomCleared?: () => void;
	className?: string;
}

export function InlineExchangeRateSelector({
	currency,
	homeCurrency: _homeCurrency,
	value,
	mode = true,
	isCustomSet = false,
	onValueChange,
	onCustomSelected,
	onCustomSet,
	onCustomCleared,
	className,
}: InlineExchangeRateSelectorProps) {
	const [selectedRateType, setSelectedRateType] = useState<string>(
		isCustomSet ? "custom" : "official",
	);

	// Use ref to avoid stale closure in useEffect
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	const { rateOptions, getDefaultRate, getRateByType, getEffectiveRate } =
		useExchangeRates({
			currency,
			includeCustomOption: true,
			preferFavorites: true,
		});

	// Set default rate on mount based on favorites
	useEffect(() => {
		if (rateOptions.length > 0 && !value && !isCustomSet) {
			const defaultRate = getDefaultRate();
			if (defaultRate) {
				setSelectedRateType(defaultRate.type);
				onValueChangeRef.current(
					getEffectiveRate(defaultRate.rate, !mode),
					defaultRate.type,
				);
			}
		} else if (isCustomSet) {
			setSelectedRateType("custom");
		}
	}, [rateOptions, value, isCustomSet, getDefaultRate, getEffectiveRate, mode]);

	// Handle rate type selection
	const handleRateTypeChange = useCallback(
		(type: string) => {
			setSelectedRateType(type);

			if (type === "custom") {
				onCustomSet?.();
				onCustomSelected();
			} else {
				// Clear custom rate flag when selecting non-custom rate
				onCustomCleared?.();
				// Predefined rate
				const selectedRate = getRateByType(type);
				if (selectedRate) {
					onValueChange(
						getEffectiveRate(selectedRate.rate, !mode),
						selectedRate.type,
					);
				}
			}
		},
		[
			onCustomSet,
			onCustomSelected,
			onCustomCleared,
			getRateByType,
			getEffectiveRate,
			mode,
			onValueChange,
		],
	);

	return (
		<div className={cn("", className)}>
			<Select onValueChange={handleRateTypeChange} value={selectedRateType}>
				<SelectTrigger className="h-9">
					<SelectValue placeholder="Select rate" />
				</SelectTrigger>
				<SelectContent>
					{rateOptions.map((option) => (
						<SelectItem key={option.type} value={option.type}>
							<div className="flex w-full min-w-0 items-center justify-between">
								<span className="truncate">{option.label}</span>
								{option.type !== "custom" && (
									<span className="ml-2 flex-shrink-0 text-muted-foreground text-sm">
										{option.rate.toLocaleString()}
									</span>
								)}
								{option.type === "custom" && value && (
									<span className="ml-2 flex-shrink-0 text-muted-foreground text-sm">
										{(mode === false ? 1 / value : value).toLocaleString()}
									</span>
								)}
							</div>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

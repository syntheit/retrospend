"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import { cn } from "~/lib/utils";

type DisplayMode = "default-to-foreign" | "foreign-to-default";

interface ExchangeRateSelectorProps {
	currency: string;
	homeCurrency: string;
	value?: number;
	displayMode?: DisplayMode; // "default-to-foreign" = "1 default = X foreign", "foreign-to-default" = "X foreign = 1 default"
	onValueChange: (value: number | undefined) => void;
	className?: string;
}

export function ExchangeRateSelector({
	currency,
	homeCurrency,
	value,
	displayMode = "default-to-foreign",
	onValueChange,
	className,
}: ExchangeRateSelectorProps) {
	const [selectedRateType, setSelectedRateType] = useState<string>("official");
	const [customRate, setCustomRate] = useState<string>("");

	// Use ref to avoid stale closure in useEffect
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	const { rateOptions, isLoading, getDefaultRate, getRateByType } =
		useExchangeRates({
			currency,
			includeCustomOption: true,
		});

	// Set default rate on mount
	useEffect(() => {
		if (rateOptions.length > 0 && value === undefined) {
			const defaultRate = getDefaultRate();
			if (defaultRate) {
				setSelectedRateType(defaultRate.type);
				onValueChangeRef.current(defaultRate.rate);
			}
		}
	}, [rateOptions, value, getDefaultRate]);

	const handleRateTypeChange = (type: string) => {
		setSelectedRateType(type);

		if (type === "custom") {
			// Custom rate - use current custom value if valid, otherwise undefined
			const rateValue = customRate.trim() ? parseFloat(customRate) : undefined;
			onValueChange(
				rateValue && !Number.isNaN(rateValue) ? rateValue : undefined,
			);
		} else {
			// Predefined rate
			const selectedRate = getRateByType(type);
			if (selectedRate) {
				onValueChange(selectedRate.rate);
				setCustomRate(selectedRate.rate.toString());
			}
		}
	};

	const handleCustomRateChange = (inputValue: string) => {
		setCustomRate(inputValue);
		const numericValue = inputValue.trim() ? parseFloat(inputValue) : undefined;
		// Only call onValueChange if we have a valid number or undefined
		if (numericValue === undefined || !Number.isNaN(numericValue)) {
			onValueChange(numericValue);
		}
	};

	const selectedOption = rateOptions.find(
		(option) => option.type === selectedRateType,
	);

	return (
		<div className={cn("space-y-3", className)}>
			{/* Rate Type Selection */}
			<div className="space-y-2">
				<Label className="font-medium text-sm">Rate Type</Label>
				<Select
					disabled={isLoading}
					onValueChange={handleRateTypeChange}
					value={selectedRateType}
				>
					<SelectTrigger className="h-10">
						<SelectValue
							placeholder={isLoading ? "Loading rates..." : "Select rate type"}
						/>
					</SelectTrigger>
					<SelectContent>
						{rateOptions.map((option) => (
							<SelectItem key={option.type} value={option.type}>
								<div className="flex w-full items-center justify-between">
									<span>{option.label}</span>
									{option.type !== "custom" && (
										<span className="text-muted-foreground text-sm">
											{option.rate.toLocaleString()}
										</span>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Custom Rate Input */}
			{selectedRateType === "custom" && (
				<div className="space-y-2">
					<Label className="font-medium text-sm" htmlFor="custom-rate">
						Custom Rate
					</Label>
					<Input
						className="h-10"
						id="custom-rate"
						onChange={(e) => handleCustomRateChange(e.target.value)}
						placeholder="Enter custom rate"
						step="0.000001"
						type="number"
						value={customRate}
					/>
				</div>
			)}

			{/* Current Rate Display */}
			{selectedRateType !== "custom" &&
				selectedOption &&
				selectedOption.rate > 0 && (
					<div className="flex items-center justify-center rounded-md border bg-muted/30 p-3">
						<p className="font-medium text-foreground text-sm">
							{displayMode === "default-to-foreign"
								? `1 ${homeCurrency} = ${selectedOption.rate.toLocaleString()} ${currency}`
								: `1 ${currency} = ${selectedOption.rate !== 0 ? (1 / selectedOption.rate).toFixed(6) : "0"} ${homeCurrency}`}
						</p>
					</div>
				)}
		</div>
	);
}

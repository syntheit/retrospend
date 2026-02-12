"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export type RateSelectorVariant = "default" | "inline";

interface RateSelectorProps {
	/** UI style of the selector */
	variant?: RateSelectorVariant;
	/** Currency to select a rate for */
	currency: string;
	/** User's home currency (usually USD) */
	homeCurrency: string;
	/** Current numeric value of the rate */
	value?: number;
	/** How the rate is displayed and calculated */
	displayMode?: "default-to-foreign" | "foreign-to-default";
	/** Whether a custom rate is currently active */
	isCustomSet?: boolean;
	/** Callback when rate or type changes */
	onValueChange: (value: number | undefined, type?: string) => void;
	/** Callback for inline variant to trigger external custom rate dialog */
	onCustomClick?: () => void;
	/** Callback when switching to custom mode */
	onCustomSet?: () => void;
	/** Callback when switching away from custom mode */
	onCustomCleared?: () => void;
	/** Optional CSS class */
	className?: string;
}

/**
 * A unified primitive for selecting exchange rates.
 * Supports both standard block layout and compact inline layout.
 */
export function RateSelector({
	variant = "default",
	currency,
	homeCurrency,
	value,
	displayMode = "default-to-foreign",
	isCustomSet = false,
	onValueChange,
	onCustomClick,
	onCustomSet,
	onCustomCleared,
	className,
}: RateSelectorProps) {
	const [selectedRateType, setSelectedRateType] = useState<string>(
		isCustomSet ? "custom" : "official",
	);
	const [customInputValue, setCustomInputValue] = useState<string>(
		value?.toString() ?? "",
	);

	const isInverse = displayMode === "foreign-to-default";

	const {
		rateOptions,
		isLoading,
		getDefaultRate,
		getRateByType,
		getEffectiveRate,
	} = useExchangeRates({
		currency,
		includeCustomOption: true,
		preferFavorites: variant === "inline",
	});

	// Ref to prevent stale closures in effects
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	// Set default rate on mount if no value is present
	useEffect(() => {
		if (rateOptions.length > 0 && !value && !isCustomSet) {
			const defaultRate = getDefaultRate();
			if (defaultRate) {
				setSelectedRateType(defaultRate.type);
				onValueChangeRef.current(
					getEffectiveRate(defaultRate.rate, isInverse),
					defaultRate.type,
				);
			}
		} else if (isCustomSet) {
			setSelectedRateType("custom");
		}
	}, [
		rateOptions,
		value,
		isCustomSet,
		getDefaultRate,
		getEffectiveRate,
		isInverse,
	]);

	const handleRateTypeChange = useCallback(
		(type: string) => {
			setSelectedRateType(type);

			if (type === "custom") {
				onCustomSet?.();
				if (variant === "inline") {
					onCustomClick?.();
				} else {
					setCustomInputValue(value?.toString() ?? "");
				}
			} else {
				onCustomCleared?.();
				const selectedRate = getRateByType(type);
				if (selectedRate) {
					onValueChange(
						getEffectiveRate(selectedRate.rate, isInverse),
						selectedRate.type,
					);
				}
			}
		},
		[
			variant,
			onCustomSet,
			onCustomClick,
			onCustomCleared,
			getRateByType,
			getEffectiveRate,
			isInverse,
			onValueChange,
			value,
		],
	);

	const handleCustomRateChange = (inputValue: string) => {
		setCustomInputValue(inputValue);
		const numericValue = inputValue.trim() ? parseFloat(inputValue) : undefined;
		if (numericValue === undefined || !Number.isNaN(numericValue)) {
			onValueChange(numericValue, "custom");
		}
	};

	// --- INLINE VARIANT ---
	if (variant === "inline") {
		return (
			<div className={cn("w-full", className)}>
				<Select onValueChange={handleRateTypeChange} value={selectedRateType}>
					<SelectTrigger className="h-9">
						<SelectValue placeholder="Select rate" />
					</SelectTrigger>
					<SelectContent>
						{rateOptions.map((option) => (
							<SelectItem key={option.type} value={option.type}>
								<div className="flex w-full min-w-0 items-center justify-between gap-4">
									<span className="truncate">{option.label}</span>
									{option.type !== "custom" && (
										<span className="shrink-0 font-mono text-muted-foreground text-sm leading-none">
											{option.rate.toLocaleString(undefined, {
												maximumFractionDigits: 6,
											})}
										</span>
									)}
									{option.type === "custom" && value && (
										<span className="shrink-0 font-mono text-muted-foreground text-sm leading-none">
											{(isInverse ? 1 / value : value).toLocaleString(
												undefined,
												{
													maximumFractionDigits: 6,
												},
											)}
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

	// --- DEFAULT VARIANT ---
	const selectedOption = rateOptions.find((o) => o.type === selectedRateType);

	return (
		<div className={cn("space-y-4", className)}>
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
								<div className="flex w-full items-center justify-between gap-4">
									<span>{option.label}</span>
									{option.type !== "custom" && (
										<span className="font-mono text-muted-foreground text-sm">
											{option.rate.toLocaleString(undefined, {
												maximumFractionDigits: 6,
											})}
										</span>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{selectedRateType === "custom" && (
				<div className="space-y-2">
					<Label className="font-medium text-sm" htmlFor="custom-rate">
						Custom Rate
					</Label>
					<Input
						className="h-10 font-mono"
						id="custom-rate"
						onChange={(e) => handleCustomRateChange(e.target.value)}
						placeholder="Enter custom rate"
						step="0.000001"
						type="number"
						value={customInputValue}
					/>
				</div>
			)}

			{!isLoading &&
				selectedOption &&
				selectedOption.rate > 0 &&
				selectedRateType !== "custom" && (
					<div className="flex items-center justify-center rounded-lg border bg-muted/30 p-3">
						<p className="font-medium text-sm">
							{isInverse
								? `1 ${currency} = ${(1 / selectedOption.rate).toLocaleString(
										undefined,
										{ maximumFractionDigits: 6 },
									)} ${homeCurrency}`
								: `1 ${homeCurrency} = ${selectedOption.rate.toLocaleString(
										undefined,
										{ maximumFractionDigits: 6 },
									)} ${currency}`}
						</p>
					</div>
				)}
		</div>
	);
}

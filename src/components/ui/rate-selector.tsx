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
import { CRYPTO_CURRENCIES } from "~/lib/currencies";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

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
	/** Currently active rate type (e.g. from saved expense) */
	activeType?: string;
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
	activeType,
	displayMode = "default-to-foreign",
	isCustomSet = false,
	onValueChange,
	onCustomClick,
	onCustomSet,
	onCustomCleared,
	className,
}: RateSelectorProps) {
	const [selectedRateType, setSelectedRateType] = useState<string>(
		isCustomSet ? "custom" : activeType || "official",
	);
	const [customInputValue, setCustomInputValue] = useState<string>(
		value?.toString() ?? "",
	);

	const isInverse = displayMode === "foreign-to-default";
	const isCrypto = currency in CRYPTO_CURRENCIES;

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

	const { data: homeRates } = api.exchangeRate.getRatesForCurrency.useQuery(
		{ currency: homeCurrency },
		{ enabled: !!homeCurrency && homeCurrency !== "USD", staleTime: 60000 },
	);

	const getHomeRate = useCallback(() => {
		if (homeCurrency === "USD") return 1;
		if (!homeRates || homeRates.length === 0) return 1;
		const blue = homeRates.find((r: any) => r.type === "blue");
		if (blue) return Number(blue.rate);
		const official = homeRates.find((r: any) => r.type === "official");
		if (official) return Number(official.rate);
		return Number((homeRates[0] as any)?.rate) || 1;
	}, [homeCurrency, homeRates]);

	const getCrossRate = useCallback(
		(dbRate: number) => {
			const rateInUSD = dbRate > 0 ? 1 / dbRate : 1;
			return rateInUSD * getHomeRate();
		},
		[getHomeRate],
	);

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
					getEffectiveRate(getCrossRate(defaultRate.rate), isInverse),
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
		getCrossRate,
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
						getEffectiveRate(getCrossRate(selectedRate.rate), isInverse),
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
			getCrossRate,
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
										<span className="shrink-0 text-muted-foreground text-sm tabular-nums leading-none">
											{(isCrypto
												? getCrossRate(option.rate)
												: option.rate
											).toLocaleString(undefined, {
												minimumFractionDigits: isCrypto ? 2 : 0,
												maximumFractionDigits: isCrypto ? 2 : 6,
											})}
										</span>
									)}
									{option.type === "custom" && value && (
										<span className="shrink-0 text-muted-foreground text-sm tabular-nums leading-none">
											{(isCrypto
												? value
												: isInverse
													? 1 / value
													: value
											).toLocaleString(undefined, {
												minimumFractionDigits: isCrypto ? 2 : 0,
												maximumFractionDigits: isCrypto ? 2 : 6,
											})}
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
										<span className="text-muted-foreground text-sm tabular-nums">
											{(isCrypto
												? getCrossRate(option.rate)
												: option.rate
											).toLocaleString(undefined, {
												minimumFractionDigits: isCrypto ? 2 : 0,
												maximumFractionDigits: isCrypto ? 2 : 6,
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
						className="h-10 tabular-nums"
						id="custom-rate"
						onChange={(e) => handleCustomRateChange(e.target.value)}
						placeholder="Enter custom rate"
						step="0.00000001"
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
							{isCrypto || isInverse
								? `1 ${currency} = ${(
										isCrypto
											? getCrossRate(selectedOption.rate)
											: 1 / selectedOption.rate
									).toLocaleString(undefined, {
										minimumFractionDigits: isCrypto ? 2 : 0,
										maximumFractionDigits: isCrypto ? 2 : 6,
									})} ${homeCurrency}`
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

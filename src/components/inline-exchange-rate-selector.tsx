"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { useSession } from "~/hooks/use-session";
import { cn } from "~/lib/utils";
import { getRateTypeLabel } from "~/lib/exchange-rates-shared";
import { api } from "~/trpc/react";

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

type RateOption = {
	type: string;
	rate: number;
	label: string;
};

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

	// At the top of the component (after useState declarations, around line 47):
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	const { data: rates } = api.exchangeRate.getRatesForCurrency.useQuery(
		{ currency },
		{ enabled: !!currency },
	);

	const { data: session } = useSession();
	const { data: favorites } = api.user.getFavoriteExchangeRates.useQuery(
		undefined,
		{ enabled: !!session?.user },
	);

	// Helper to get effective rate based on mode
	const getEffectiveRate = useCallback(
		(rate: number) => {
			if (mode === false && rate > 0) return 1 / rate;
			return rate;
		},
		[mode],
	);

	// Create rate options with user-friendly labels
	const rateOptions: RateOption[] = rates
		? rates.map((rate) => ({
				type: rate.type,
				rate: Number(rate.rate),
				label: getRateTypeLabel(rate.type),
			}))
		: [];

	// Add custom option
	rateOptions.push({
		type: "custom",
		rate: 0,
		label: "Custom",
	});

	// Set default to preferred favorite rate if available, otherwise official or first available
	useEffect(() => {
		if (rates && rates.length > 0 && !value && !isCustomSet) {
			// Find default rate based on favorites order
			let defaultRate = null;

			if (favorites && favorites.length > 0) {
				// favorites are already ordered by 'order' asc from backend
				for (const fav of favorites) {
					// Check if this favorite matches the current currency and has a type available in rates
					if (fav.rate.currency === currency) {
						const matchingRate = rates.find((r) => r.type === fav.rate.type);
						if (matchingRate) {
							defaultRate = matchingRate;
							break; // Found the highest priority match
						}
					}
				}
			}

			if (defaultRate) {
				setSelectedRateType(defaultRate.type);
				onValueChangeRef.current(
					getEffectiveRate(Number(defaultRate.rate)),
					defaultRate.type,
				);
				return;
			}

			const blueRate = rates.find((r) => r.type === "blue");
			if (blueRate) {
				setSelectedRateType("blue");
				onValueChangeRef.current(getEffectiveRate(Number(blueRate.rate)), blueRate.type);
			} else {
				const officialRate = rates.find((r) => r.type === "official");
				if (officialRate) {
					setSelectedRateType("official");
					onValueChangeRef.current(
						getEffectiveRate(Number(officialRate.rate)),
						officialRate.type,
					);
				} else {
					const firstRate = rates[0];
					if (firstRate) {
						setSelectedRateType(firstRate.type);
						onValueChangeRef.current(
							getEffectiveRate(Number(firstRate.rate)),
							firstRate.type,
						);
					}
				}
			}
		} else if (isCustomSet) {
			setSelectedRateType("custom");
		}
	}, [
		rates,
		value,
		isCustomSet,
		getEffectiveRate,
		favorites,
		currency,
	]);

	// Handle rate type selection
	const handleRateTypeChange = (type: string) => {
		setSelectedRateType(type);

		if (type === "custom") {
			onCustomSet?.();
			onCustomSelected();
		} else {
			// Clear custom rate flag when selecting non-custom rate
			onCustomCleared?.();
			setSelectedRateType(type);
			// Predefined rate
			const selectedRate = rateOptions.find((option) => option.type === type);
			if (selectedRate) {
				onValueChange(getEffectiveRate(selectedRate.rate), selectedRate.type);
			}
		}
	};

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
										{mode === false
											? getEffectiveRate(option.rate).toFixed(6)
											: getEffectiveRate(option.rate).toLocaleString()}
									</span>
								)}
								{option.type === "custom" && value && (
									<span className="ml-2 flex-shrink-0 text-muted-foreground text-sm">
										{mode === false ? value.toFixed(6) : value.toLocaleString()}
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import { isCrypto } from "~/lib/currency-format";
import { convert } from "~/lib/currency-math";

interface UseCurrencyCalculatorOptions {
	homeCurrency: string;
	defaultCurrency: string;
	externalCurrency?: string | null;
}

export function useCurrencyCalculator({
	homeCurrency,
	defaultCurrency,
	externalCurrency,
}: UseCurrencyCalculatorOptions) {
	const [topCurrency, setTopCurrency] = useState(homeCurrency);
	const [bottomCurrency, setBottomCurrency] = useState(defaultCurrency);
	const [topAmount, setTopAmount] = useState("");
	const [bottomAmount, setBottomAmount] = useState("");
	const [lastEdited, setLastEdited] = useState<"top" | "bottom">("top");
	const [selectedRateType, setSelectedRateType] = useState<string | null>(null);

	const {
		rawRateOptions: topRateOptions,
		isLoading: topRatesLoading,
		getDefaultRate: getTopDefaultRate,
		getRateByType: getTopRateByType,
	} = useExchangeRates({ currency: topCurrency, preferFavorites: true });

	const {
		rawRateOptions: bottomRateOptions,
		isLoading: bottomRatesLoading,
		getDefaultRate: getBottomDefaultRate,
		getRateByType: getBottomRateByType,
	} = useExchangeRates({ currency: bottomCurrency, preferFavorites: true });

	// Determine which currency shows the rate strip (multi-rate)
	const topHasMultipleRates = topRateOptions.length > 1;
	const bottomHasMultipleRates = bottomRateOptions.length > 1;

	// Show strip for: bottom if multi-rate, else top if multi-rate, else none
	const stripCurrency = bottomHasMultipleRates
		? "bottom"
		: topHasMultipleRates
			? "top"
			: null;

	const stripRateOptions =
		stripCurrency === "bottom"
			? bottomRateOptions
			: stripCurrency === "top"
				? topRateOptions
				: [];

	// Get the active rate for each side
	const getActiveTopRate = useCallback((): number | undefined => {
		if (topCurrency === "USD") return 1;
		if (stripCurrency === "top" && selectedRateType) {
			const r = getTopRateByType(selectedRateType);
			if (r) return r.rate;
		}
		const def = getTopDefaultRate();
		return def?.rate;
	}, [
		topCurrency,
		stripCurrency,
		selectedRateType,
		getTopRateByType,
		getTopDefaultRate,
	]);

	const getActiveBottomRate = useCallback((): number | undefined => {
		if (bottomCurrency === "USD") return 1;
		if (stripCurrency === "bottom" && selectedRateType) {
			const r = getBottomRateByType(selectedRateType);
			if (r) return r.rate;
		}
		const def = getBottomDefaultRate();
		return def?.rate;
	}, [
		bottomCurrency,
		stripCurrency,
		selectedRateType,
		getBottomRateByType,
		getBottomDefaultRate,
	]);

	// Auto-select rate type when strip currency changes
	const prevStripCurrency = useRef(stripCurrency);
	useEffect(() => {
		if (stripCurrency !== prevStripCurrency.current) {
			prevStripCurrency.current = stripCurrency;
			if (stripCurrency === "bottom") {
				const def = getBottomDefaultRate();
				setSelectedRateType(def?.type ?? null);
			} else if (stripCurrency === "top") {
				const def = getTopDefaultRate();
				setSelectedRateType(def?.type ?? null);
			} else {
				setSelectedRateType(null);
			}
		}
	}, [stripCurrency, getBottomDefaultRate, getTopDefaultRate]);

	// Recompute on any change
	const recompute = useCallback(
		(
			direction: "top" | "bottom",
			tAmt: string,
			bAmt: string,
		) => {
			const topRate = getActiveTopRate();
			const bottomRate = getActiveBottomRate();

			if (direction === "top") {
				const parsed = parseFloat(tAmt);
				if (!tAmt || isNaN(parsed)) {
					setBottomAmount("");
					return;
				}
				const result = convert(
					parsed,
					topCurrency,
					topRate,
					bottomCurrency,
					bottomRate,
				);
				setBottomAmount(result ? formatNumber(result, bottomCurrency) : "");
			} else {
				const parsed = parseFloat(bAmt);
				if (!bAmt || isNaN(parsed)) {
					setTopAmount("");
					return;
				}
				const result = convert(
					parsed,
					bottomCurrency,
					bottomRate,
					topCurrency,
					topRate,
				);
				setTopAmount(result ? formatNumber(result, topCurrency) : "");
			}
		},
		[topCurrency, bottomCurrency, getActiveTopRate, getActiveBottomRate],
	);

	// Recompute when rates change (loading finishes, rate type toggle)
	useEffect(() => {
		if (topRatesLoading || bottomRatesLoading) return;
		if (lastEdited === "top" && topAmount) {
			recompute("top", topAmount, bottomAmount);
		} else if (lastEdited === "bottom" && bottomAmount) {
			recompute("bottom", topAmount, bottomAmount);
		}
		// Only recompute when rates or rate type changes, not on every amount keystroke
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		selectedRateType,
		topRatesLoading,
		bottomRatesLoading,
		topCurrency,
		bottomCurrency,
	]);

	const handleTopAmountChange = useCallback(
		(value: string) => {
			setTopAmount(value);
			setLastEdited("top");
			recompute("top", value, bottomAmount);
		},
		[recompute, bottomAmount],
	);

	const handleBottomAmountChange = useCallback(
		(value: string) => {
			setBottomAmount(value);
			setLastEdited("bottom");
			recompute("bottom", topAmount, value);
		},
		[recompute, topAmount],
	);

	const handleTopCurrencyChange = useCallback(
		(currency: string) => {
			setTopCurrency(currency);
		},
		[],
	);

	const handleBottomCurrencyChange = useCallback(
		(currency: string) => {
			setBottomCurrency(currency);
		},
		[],
	);

	const handleRateTypeChange = useCallback((type: string) => {
		setSelectedRateType(type);
	}, []);

	const swap = useCallback(() => {
		setTopCurrency(bottomCurrency);
		setBottomCurrency(topCurrency);
		setTopAmount(bottomAmount);
		setBottomAmount(topAmount);
		setLastEdited((prev) => (prev === "top" ? "bottom" : "top"));
	}, [topCurrency, bottomCurrency, topAmount, bottomAmount]);

	// Handle external currency click (from table/cards)
	const prevExternal = useRef(externalCurrency);
	useEffect(() => {
		if (
			externalCurrency &&
			externalCurrency !== prevExternal.current
		) {
			setBottomCurrency(externalCurrency);
			prevExternal.current = externalCurrency;
		}
	}, [externalCurrency]);

	// Get the display rate for the pill (single-rate or cross-rate)
	const displayRate = useMemo(() => {
		const topRate = getActiveTopRate();
		const bottomRate = getActiveBottomRate();
		if (!topRate || !bottomRate) return null;

		// Cross-rate: 1 unit of top currency = X units of bottom
		const result = convert(1, topCurrency, topRate, bottomCurrency, bottomRate);
		return result || null;
	}, [
		topCurrency,
		bottomCurrency,
		getActiveTopRate,
		getActiveBottomRate,
	]);

	return {
		topCurrency,
		bottomCurrency,
		topAmount,
		bottomAmount,
		lastEdited,
		selectedRateType,
		stripCurrency,
		stripRateOptions,
		displayRate,
		isLoading: topRatesLoading || bottomRatesLoading,

		handleTopAmountChange,
		handleBottomAmountChange,
		handleTopCurrencyChange,
		handleBottomCurrencyChange,
		handleRateTypeChange,
		swap,
	};
}

function formatNumber(value: number, currency: string): string {
	if (isCrypto(currency)) {
		return value.toFixed(8).replace(/\.?0+$/, "");
	}
	return value.toFixed(2);
}

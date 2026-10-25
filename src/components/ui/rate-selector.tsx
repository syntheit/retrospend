"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
	isValidRate,
	pickBestRate,
	quoteRate,
	type RateQuote,
	rateFromQuote,
	USD,
} from "@retrospend/domain/money";
import { autoRateSelection } from "~/lib/rate-selection";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export type RateSelectorVariant = "default" | "inline";

interface RateSelectorProps {
	/** UI style of the selector */
	variant?: RateSelectorVariant;
	/** Currency to select a rate for */
	currency: string;
	/** Currency the rate is shown against (USD for assets) */
	homeCurrency: string;
	/** Current rate in the stored convention (see ~/lib/money) */
	value?: number;
	/** Whether a custom rate is currently active */
	isCustomSet?: boolean;
	/** Called with a rate in the stored convention and its type */
	onValueChange: (value: number | undefined, type?: string) => void;
	/** Callback when switching to custom mode */
	onCustomSet?: () => void;
	/** Callback when switching away from custom mode */
	onCustomCleared?: () => void;
	/** Optional CSS class */
	className?: string;
	/** Currently active rate type (e.g. from saved expense) */
	activeType?: string;
}

function formatQuoteValue(value: number): string {
	return value.toLocaleString(undefined, {
		maximumFractionDigits: value >= 100 ? 2 : 6,
	});
}

/**
 * A unified primitive for selecting exchange rates. Values in and out are
 * stored rates (fiat: units per USD, crypto: USD per coin); what the user
 * sees and types is a quote against `homeCurrency` ("1 USD = 1560 ARS"),
 * converted with ~/lib/money.
 */
export function RateSelector({
	variant = "default",
	currency,
	homeCurrency,
	value,
	activeType,
	isCustomSet = false,
	onValueChange,
	onCustomSet,
	onCustomCleared,
	className,
}: RateSelectorProps) {
	const t = useTranslations("ui");
	const [selectedRateType, setSelectedRateType] = useState<string>(
		isCustomSet ? "custom" : activeType || "official",
	);

	// Sync local state with parent prop updates
	useEffect(() => {
		if (activeType) {
			setSelectedRateType(activeType);
		}
	}, [activeType]);

	const { rateOptions, isLoading, getDefaultRate, getRateByType } =
		useExchangeRates({
			currency,
			includeCustomOption: true,
			preferFavorites: variant === "inline",
		});

	const { data: homeRates } = api.exchangeRate.getRatesForCurrency.useQuery(
		{ currency: homeCurrency },
		{ enabled: !!homeCurrency && homeCurrency !== USD, staleTime: 60000 },
	);

	const homeRate = useMemo(() => {
		if (homeCurrency === USD) return 1;
		const rows = (homeRates ?? []).map((r) => ({
			type: r.type,
			rate: Number(r.rate),
			date: new Date(r.date),
		}));
		return pickBestRate(rows)?.rate ?? null;
	}, [homeCurrency, homeRates]);

	const quoteFor = useCallback(
		(rate: number | undefined): RateQuote | null => {
			if (!isValidRate(rate) || homeRate === null) return null;
			return quoteRate(currency, rate, homeCurrency, homeRate);
		},
		[currency, homeCurrency, homeRate],
	);

	// Custom input: typed as a quote, oriented like the current rate's quote
	const [customInput, setCustomInput] = useState<string>("");
	const [customSides, setCustomSides] = useState<{
		base: string;
		quote: string;
	} | null>(null);

	const startCustom = useCallback(() => {
		const current = quoteFor(value) ?? quoteFor(getDefaultRate()?.rate);
		setCustomSides(
			current
				? { base: current.base, quote: current.quote }
				: { base: homeCurrency, quote: currency },
		);
		setCustomInput(current ? String(Number(current.value.toPrecision(8))) : "");
	}, [quoteFor, value, getDefaultRate, homeCurrency, currency]);

	// Ref to prevent stale closures in effects
	const onValueChangeRef = useRef(onValueChange);
	onValueChangeRef.current = onValueChange;

	// Select on its own only what the user has not chosen: a saved rate keeps
	// its saved type, and only a missing rate gets the default one.
	useEffect(() => {
		if (rateOptions.length === 0 && !isCustomSet) return;
		const choice = autoRateSelection({
			value,
			activeType,
			isCustomSet,
			getRateByType,
			getDefaultRate,
		});
		if (!choice) return;
		setSelectedRateType(choice.type);
		if (choice.rate !== undefined) {
			onValueChangeRef.current(choice.rate, choice.type);
		}
	}, [rateOptions, value, activeType, isCustomSet, getRateByType, getDefaultRate]);

	// A saved custom rate shows up in the input once quotes can be built
	useEffect(() => {
		if (isCustomSet && customSides === null && homeRate !== null) {
			startCustom();
		}
	}, [isCustomSet, customSides, homeRate, startCustom]);

	const handleRateTypeChange = useCallback(
		(type: string) => {
			setSelectedRateType(type);

			if (type === "custom") {
				onCustomSet?.();
				startCustom();
			} else {
				onCustomCleared?.();
				const selectedRate = getRateByType(type);
				if (selectedRate) {
					onValueChange(selectedRate.rate, selectedRate.type);
				}
			}
		},
		[onCustomSet, onCustomCleared, getRateByType, onValueChange, startCustom],
	);

	const handleCustomRateChange = (inputValue: string) => {
		setCustomInput(inputValue);
		const numericValue = inputValue.trim() ? Number.parseFloat(inputValue) : NaN;
		if (!customSides || !isValidRate(numericValue) || homeRate === null) {
			onValueChange(undefined, "custom");
			return;
		}
		onValueChange(
			rateFromQuote(
				{ ...customSides, value: numericValue },
				currency,
				homeCurrency,
				homeRate,
			),
			"custom",
		);
	};

	const optionLabel = (rate: number) => {
		const quote = quoteFor(rate);
		return quote ? formatQuoteValue(quote.value) : "";
	};

	const customField = selectedRateType === "custom" && customSides && (
		<div className="space-y-2">
			<Label className="font-medium text-sm" htmlFor="custom-rate">
				{t("customRate")}: 1 {customSides.base} = {customSides.quote}
			</Label>
			<Input
				className="h-10 tabular-nums"
				id="custom-rate"
				inputMode="decimal"
				onChange={(e) => handleCustomRateChange(e.target.value)}
				placeholder={t("enterCustomRate")}
				step="any"
				type="number"
				value={customInput}
			/>
		</div>
	);

	// --- INLINE VARIANT ---
	if (variant === "inline") {
		return (
			<div className={cn("w-full space-y-2", className)}>
				<Select onValueChange={handleRateTypeChange} value={selectedRateType}>
					<SelectTrigger className="h-9">
						<SelectValue placeholder={t("selectRate")} />
					</SelectTrigger>
					<SelectContent>
						{rateOptions.map((option) => (
							<SelectItem key={option.type} value={option.type}>
								<div className="flex w-full min-w-0 items-center justify-between gap-4">
									<span className="truncate">{option.label}</span>
									<span className="shrink-0 text-muted-foreground text-sm tabular-nums leading-none">
										{option.type === "custom"
											? isCustomSet
												? optionLabel(value ?? 0)
												: ""
											: optionLabel(option.rate)}
									</span>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{customField}
			</div>
		);
	}

	// --- DEFAULT VARIANT ---
	const selectedOption = rateOptions.find((o) => o.type === selectedRateType);
	const selectedQuote =
		selectedOption && selectedRateType !== "custom"
			? quoteFor(selectedOption.rate)
			: null;

	return (
		<div className={cn("space-y-4", className)}>
			<div className="space-y-2">
				<Label className="font-medium text-sm">{t("rateType")}</Label>
				<Select
					disabled={isLoading}
					onValueChange={handleRateTypeChange}
					value={selectedRateType}
				>
					<SelectTrigger className="h-10">
						<SelectValue
							placeholder={isLoading ? t("loadingRates") : t("selectRateType")}
						/>
					</SelectTrigger>
					<SelectContent>
						{rateOptions.map((option) => (
							<SelectItem key={option.type} value={option.type}>
								<div className="flex w-full items-center justify-between gap-4">
									<span>{option.label}</span>
									{option.type !== "custom" && (
										<span className="text-muted-foreground text-sm tabular-nums">
											{optionLabel(option.rate)}
										</span>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{customField}

			{!isLoading && selectedQuote && (
				<div className="flex items-center justify-center rounded-lg border bg-muted/30 p-3">
					<p className="font-medium text-sm">
						1 {selectedQuote.base} = {formatQuoteValue(selectedQuote.value)}{" "}
						{selectedQuote.quote}
					</p>
				</div>
			)}
		</div>
	);
}

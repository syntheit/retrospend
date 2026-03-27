"use client";

import { Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { CurrencyPicker } from "~/components/currency-picker";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useExchangeRates } from "~/hooks/use-exchange-rates";
import type { ExpenseFormData } from "~/hooks/use-expense-form";
import {
	formatNumber,
	getDecimalDigits,
	isCrypto as checkIsCrypto,
	isMajorCrypto,
} from "~/lib/currency-format";
import { getRateTypeLabel } from "~/lib/exchange-rates-shared";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

// Easter egg: replace math constants (pi/π, e/ℯ) with their numeric values
function replaceConstants(expr: string): string {
	return expr
		.replace(/\bpi\b|π/gi, String(Math.PI))
		.replace(/ℯ/g, String(Math.E))
		.replace(/\be\b/g, String(Math.E));
}

// Safe arithmetic evaluator - no eval, regex-gated input
function evaluateExpression(expr: string): number | null {
	const trimmed = expr.trim();
	if (!trimmed) return null;
	const withConstants = replaceConstants(trimmed);
	// Only allow digits, spaces, +, -, *, /, ., ()
	if (!/^[\d\s+\-*/.()]+$/.test(withConstants)) return null;
	// Guard against division by zero
	if (/\/\s*0(?!\d)/.test(withConstants)) return null;
	try {
		// eslint-disable-next-line no-new-func
		const result = new Function('"use strict"; return (' + withConstants + ")")() as unknown;
		if (typeof result !== "number" || !isFinite(result) || result <= 0)
			return null;
		return Math.round((result as number) * 100) / 100;
	} catch {
		return null;
	}
}

interface CurrencyAmountInputProps {
	handleAmountChange: (value: number) => void;
	handleCurrencyChange: (currency: string) => void;
	handleExchangeRateChange: (
		rate: number | undefined,
		type?: string,
		shouldDirty?: boolean,
	) => void;
	homeCurrency: string;
	isCustomRateSet: boolean;
	setIsCustomRateSet: (v: boolean) => void;
	amountHint?: { amount: number; currency: string } | null;
}

export function CurrencyAmountInput({
	handleAmountChange,
	handleCurrencyChange,
	handleExchangeRateChange,
	homeCurrency,
	isCustomRateSet,
	setIsCustomRateSet,
	amountHint,
}: CurrencyAmountInputProps) {
	const {
		watch,
		setValue: setFormValue,
		formState: { errors },
	} = useFormContext<ExpenseFormData>();
	const { getCurrencySymbol } = useCurrencyFormatter();

	const watchedCurrency = watch("currency");
	const watchedAmount = watch("amount");
	const watchedExchangeRate = watch("exchangeRate");
	const watchedPricingSource = watch("pricingSource");
	const watchedAmountInUSD = watch("amountInUSD");

	const isForeignCurrency = watchedCurrency !== homeCurrency;
	const isCrypto = checkIsCrypto(watchedCurrency);

	const {
		rawRateOptions,
		isLoading: ratesLoading,
		getDefaultRate,
		getRateByType,
		getEffectiveRate,
	} = useExchangeRates({
		currency: watchedCurrency,
		includeCustomOption: false,
		preferFavorites: true,
		enabled: isForeignCurrency,
	});

	const { data: homeRates } = api.exchangeRate.getRatesForCurrency.useQuery(
		{ currency: homeCurrency },
		{ enabled: !!homeCurrency && homeCurrency !== "USD", staleTime: 60000 },
	);

	// --- Cross-rate logic (from rate-selector.tsx) ---
	const getHomeRate = useCallback(() => {
		if (homeCurrency === "USD") return 1;
		if (!homeRates || homeRates.length === 0) return 1;
		const blue = homeRates.find((r) => r.type === "blue");
		if (blue) return Number(blue.rate);
		const official = homeRates.find((r) => r.type === "official");
		if (official) return Number(official.rate);
		return Number(homeRates[0]?.rate) || 1;
	}, [homeCurrency, homeRates]);

	const getCrossRate = useCallback(
		(dbRate: number) => {
			const homeRate = getHomeRate();
			if (isCrypto) {
				let rate = dbRate;
				if (isMajorCrypto(watchedCurrency) && rate > 0 && rate < 1) {
					rate = 1 / rate;
				}
				return rate * homeRate;
			}
			return dbRate > 0 ? homeRate / dbRate : 0;
		},
		[getHomeRate, isCrypto, watchedCurrency],
	);

	// --- Local state ---
	const [selectedRateType, setSelectedRateType] = useState<string>(
		isCustomRateSet ? "custom" : watchedPricingSource || "official",
	);
	const [customInputValue, setCustomInputValue] = useState<string>(
		watchedExchangeRate?.toString() ?? "",
	);
	const [showCustomInput, setShowCustomInput] = useState(
		isCustomRateSet,
	);

	// --- Expression input state ---
	const [expressionText, setExpressionTextState] = useState<string>(() => {
		if (
			typeof watchedAmount === "number" &&
			isFinite(watchedAmount) &&
			watchedAmount > 0
		) {
			return watchedAmount.toString();
		}
		return "";
	});
	// Ref so blur handler always has latest value without stale closure
	const expressionTextRef = useRef(expressionText);
	const setExpressionText = (val: string) => {
		expressionTextRef.current = val;
		setExpressionTextState(val);
	};

	// Invalid character warnings
	const [invalidCharWarn, setInvalidCharWarn] = useState(false);
	const invalidCharTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const flashInvalidChar = () => {
		setInvalidCharWarn(true);
		clearTimeout(invalidCharTimerRef.current);
		invalidCharTimerRef.current = setTimeout(
			() => setInvalidCharWarn(false),
			1500,
		);
	};

	const [invalidRateWarn, setInvalidRateWarn] = useState(false);
	const invalidRateTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const flashInvalidRate = () => {
		setInvalidRateWarn(true);
		clearTimeout(invalidRateTimerRef.current);
		invalidRateTimerRef.current = setTimeout(
			() => setInvalidRateWarn(false),
			1500,
		);
	};

	// Sync expression text from external amount changes (edit mode load)
	useEffect(() => {
		const current = expressionTextRef.current;
		const hasExpr = /[+\-*/]/.test(current) || /\bpi\b|π|ℯ|\be\b/i.test(current);
		if (hasExpr) return; // Don't interrupt an active expression
		if (
			typeof watchedAmount === "number" &&
			isFinite(watchedAmount) &&
			watchedAmount > 0
		) {
			const parsed = parseFloat(current);
			if (isNaN(parsed) || Math.abs(parsed - watchedAmount) > 0.0001) {
				setExpressionText(watchedAmount.toString());
			}
		} else if (
			!watchedAmount ||
			(watchedAmount as unknown as string) === "" ||
			Number.isNaN(watchedAmount as number)
		) {
			if (current !== "") setExpressionText("");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [watchedAmount]);

	const hasExpression = /[+\-*/]/.test(expressionText) || /\bpi\b|π|ℯ|\be\b/i.test(expressionText);
	const evaluatedPreview = hasExpression
		? evaluateExpression(expressionText)
		: null;

	const handleExpressionChange = (value: string) => {
		// Strip commas (from paste or leftover formatting)
		const cleaned = value.replace(/,/g, "");
		if (cleaned.length > 0 && !/^[\d\s+\-*/.()pieπℯ]*$/i.test(cleaned)) {
			flashInvalidChar();
			return;
		}
		// Use cleaned value from here
		value = cleaned;
		setInvalidCharWarn(false);
		setExpressionText(value);
		const isExpression = /[+\-*/]/.test(value) || /\bpi\b|π|ℯ|\be\b/i.test(value);
		if (!isExpression) {
			// Plain number: update form immediately
			const numVal = parseFloat(value);
			if (!isNaN(numVal) && numVal > 0) {
				setFormValue("amount", numVal, { shouldDirty: true });
				handleAmountChange(numVal);
			}
		} else {
			// Expression: update conversion preview with evaluated result
			const evaluated = evaluateExpression(value);
			if (evaluated !== null) {
				handleAmountChange(evaluated);
			}
		}
	};

	const handleExpressionFocus = useCallback(() => {
		setExpressionText(expressionTextRef.current.replace(/,/g, ""));
	}, []);

	const handleExpressionBlur = useCallback(() => {
		const current = expressionTextRef.current;
		const isExpr = /[+\-*/]/.test(current) || /\bpi\b|π|ℯ|\be\b/i.test(current);
		if (isExpr) {
			const result = evaluateExpression(current);
			if (result !== null) {
				const decimals = getDecimalDigits(watchedCurrency);
				setExpressionText(formatNumber(result, decimals));
				setFormValue("amount", result, {
					shouldDirty: true,
					shouldValidate: true,
				});
				handleAmountChange(result);
			}
		} else {
			const num = parseFloat(current);
			if (!isNaN(num) && num > 0) {
				const decimals = getDecimalDigits(watchedCurrency);
				setExpressionText(formatNumber(num, decimals));
			}
		}
	}, [setFormValue, handleAmountChange, watchedCurrency]);

	const handleExpressionKeyDown = (
		e: React.KeyboardEvent<HTMLInputElement>,
	) => {
		if (e.key === "Enter" || e.key === "Tab") {
			handleExpressionBlur();
		}
	};

	// Sync selected type with external pricingSource changes
	useEffect(() => {
		if (watchedPricingSource) {
			setSelectedRateType(watchedPricingSource);
			if (watchedPricingSource === "custom") {
				setShowCustomInput(true);
				setCustomInputValue(watchedExchangeRate?.toString() ?? "");
			}
		}
	}, [watchedPricingSource, watchedExchangeRate]);

	// --- Auto-select default rate ---
	const hasAutoSelected = useRef(false);
	const prevCurrency = useRef(watchedCurrency);

	// Reset on currency change
	useEffect(() => {
		if (prevCurrency.current !== watchedCurrency) {
			hasAutoSelected.current = false;
			prevCurrency.current = watchedCurrency;
			setShowCustomInput(false);
		}
	}, [watchedCurrency]);

	useEffect(() => {
		if (hasAutoSelected.current || !isForeignCurrency) return;
		if (rawRateOptions.length === 0) return;
		if (isCustomRateSet) {
			setSelectedRateType("custom");
			hasAutoSelected.current = true;
			return;
		}

		// In edit mode, try to match saved pricingSource
		if (watchedPricingSource && watchedPricingSource !== "custom") {
			const match = getRateByType(watchedPricingSource);
			if (match) {
				setSelectedRateType(match.type);
				hasAutoSelected.current = true;
				return;
			}
		}

		const defaultRate = getDefaultRate();
		if (defaultRate) {
			setSelectedRateType(defaultRate.type);
			const rate =
				homeCurrency === "USD"
					? defaultRate.rate
					: getCrossRate(defaultRate.rate);
			handleExchangeRateChange(
				isCrypto ? rate : getEffectiveRate(rate, false),
				defaultRate.type,
				false, // auto-selection should not mark form as dirty
			);
			hasAutoSelected.current = true;
		}
	}, [
		rawRateOptions,
		isForeignCurrency,
		isCustomRateSet,
		watchedPricingSource,
		getDefaultRate,
		getRateByType,
		getEffectiveRate,
		getCrossRate,
		isCrypto,
		homeCurrency,
		handleExchangeRateChange,
	]);

	// --- Rate selection handler ---
	const handleRateSelect = useCallback(
		(type: string) => {
			setSelectedRateType(type);

			if (type === "custom") {
				setIsCustomRateSet(true);
				setShowCustomInput(true);
				setCustomInputValue(watchedExchangeRate?.toString() ?? "");
				return;
			}

			setIsCustomRateSet(false);
			setShowCustomInput(false);
			const selectedRate = getRateByType(type);
			if (selectedRate) {
				const rate =
					homeCurrency === "USD"
						? selectedRate.rate
						: getCrossRate(selectedRate.rate);
				handleExchangeRateChange(
					isCrypto ? rate : getEffectiveRate(rate, false),
					selectedRate.type,
				);
			}
		},
		[
			getRateByType,
			getEffectiveRate,
			getCrossRate,
			isCrypto,
			homeCurrency,
			handleExchangeRateChange,
			setIsCustomRateSet,
			watchedExchangeRate,
		],
	);

	const handleCustomRateSubmit = useCallback(
		(inputValue: string) => {
			setCustomInputValue(inputValue);
			const numericValue = inputValue.trim()
				? parseFloat(inputValue)
				: undefined;
			if (numericValue === undefined || !Number.isNaN(numericValue)) {
				handleExchangeRateChange(numericValue, "custom");
			}
		},
		[handleExchangeRateChange],
	);

	// --- Determine mode ---
	// Mode 1: same currency as home
	// Mode 2: foreign, single rate option (or zero)
	// Mode 3: foreign, multiple rate options
	const mode = !isForeignCurrency ? 1 : rawRateOptions.length <= 1 ? 2 : 3;

	// --- Compute display values ---
	const getDisplayRateValue = (dbRate: number) => {
		const rate =
			homeCurrency === "USD" ? dbRate : getCrossRate(dbRate);
		return rate;
	};

	const formatRate = (rate: number) => {
		return rate.toLocaleString(undefined, {
			minimumFractionDigits: isCrypto ? 2 : 0,
			maximumFractionDigits: isCrypto ? 2 : 6,
		});
	};

	const convertedAmount = watchedAmountInUSD ?? 0;
	const formatConvertedAmount = (amount: number) => {
		if (!amount || amount === 0) return "0.00";
		return formatNumber(amount, 2);
	};

	// Compute preview for a given rate option
	const getPreviewAmount = (dbRate: number) => {
		if (!watchedAmount || watchedAmount === 0) return 0;
		const rate = getDisplayRateValue(dbRate);
		if (!rate || rate === 0) return 0;
		if (isCrypto) {
			return watchedAmount * rate;
		}
		return watchedAmount / rate;
	};

	// Shared amount input element
	const amountInput = (
		<Input
			autoComplete="off"
			className="h-full w-full border-0 bg-transparent px-3 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
			id="amount"
			inputMode="decimal"
			onBlur={handleExpressionBlur}
			onChange={(e) => handleExpressionChange(e.target.value)}
			onFocus={handleExpressionFocus}
			onKeyDown={handleExpressionKeyDown}
			placeholder="0.00"
			type="text"
			value={expressionText}
		/>
	);

	// Expression evaluation preview (only shown when input has an operator)
	const expressionPreview = evaluatedPreview !== null && (
		<span className="animate-in fade-in whitespace-nowrap pr-3 text-muted-foreground text-xs tabular-nums duration-150">
			= {getCurrencySymbol(watchedCurrency)}{formatNumber(evaluatedPreview, getDecimalDigits(watchedCurrency))}
		</span>
	);

	// --- Render ---
	return (
		<div className="space-y-2">
			<Label htmlFor="amount">Amount</Label>

			{mode === 1 ? (
				/* === MODE 1: Same currency === */
				<div
					className={cn(
						"flex h-9 w-full overflow-hidden rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30",
						errors.amount && "border-destructive",
					)}
				>
					<CurrencyPicker
						onValueChange={handleCurrencyChange}
						triggerClassName="h-full rounded-none border-r border-input px-3 shrink-0 focus-visible:ring-0"
						triggerDisplay="flag+code"
						triggerVariant="ghost"
						value={watchedCurrency}
					/>
					<div className="flex flex-1 items-center overflow-hidden">
						{amountInput}
						{expressionPreview}
					</div>
				</div>
			) : (
				/* === MODE 2 & 3: Foreign currency === */
				<div
					className={cn(
						"w-full overflow-hidden rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30",
						errors.amount && "border-destructive",
					)}
				>
					{/* Top row: currency picker + amount input */}
					<div className="flex h-9 items-center">
						<CurrencyPicker
							onValueChange={handleCurrencyChange}
							triggerClassName="h-full rounded-none border-r border-input px-3 shrink-0 focus-visible:ring-0"
							triggerDisplay="flag+code"
							triggerVariant="ghost"
							value={watchedCurrency}
						/>
						<div className="flex flex-1 items-center overflow-hidden">
							{amountInput}
							{expressionPreview}
						</div>
						<span className="hidden pr-3 text-muted-foreground text-sm sm:block">
							You spent
						</span>
					</div>

					{/* Divider area with rate info */}
					<div className="border-t border-input">
						{ratesLoading ? (
							<div className="flex items-center justify-center px-3 py-1.5">
								<Skeleton className="h-5 w-24" />
							</div>
						) : mode === 2 ? (
							/* Mode 2: single non-interactive rate pill */
							<div className="flex items-center justify-center px-3 py-1.5">
								{rawRateOptions.length === 0 ? (
									<NoRateAvailable
										customInputValue={customInputValue}
										onCustomRateChange={handleCustomRateSubmit}
										setIsCustomRateSet={setIsCustomRateSet}
										setSelectedRateType={setSelectedRateType}
										setShowCustomInput={setShowCustomInput}
									/>
								) : (
									<span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-sm tabular-nums text-muted-foreground">
										{isCrypto && `1 ${watchedCurrency} = `}
										{formatRate(
											getDisplayRateValue(
												rawRateOptions[0]!.rate,
											),
										)}
										{!isCrypto &&
											` ${watchedCurrency}/${homeCurrency}`}
										{isCrypto && ` ${homeCurrency}`}
									</span>
								)}
							</div>
						) : (
							/* Mode 3: segmented rate toggle strip */
							<RateSegmentStrip
								customInputValue={customInputValue}
								formatRate={formatRate}
								getDisplayRateValue={getDisplayRateValue}
								getPreviewAmount={getPreviewAmount}
								homeCurrency={homeCurrency}
								isCrypto={isCrypto}
								onCustomRateChange={handleCustomRateSubmit}
								onSelect={handleRateSelect}
								rateOptions={rawRateOptions}
								selectedType={selectedRateType}
								showCustomInput={showCustomInput}
								getCurrencySymbol={getCurrencySymbol}
							/>
						)}
					</div>

					{/* Custom rate inline input (for mode 3) */}
					{showCustomInput && mode === 3 && (
						<div className="flex items-center gap-2 border-t border-input bg-muted/10 px-3 py-1.5">
							<span className="shrink-0 text-muted-foreground text-sm">
								Custom rate:
							</span>
							<Input
								aria-label="Custom exchange rate"
								autoFocus
								className="h-7 w-28 border-input bg-transparent px-2 py-0 text-sm tabular-nums shadow-none focus-visible:ring-1 dark:bg-transparent"
								onChange={(e) =>
									handleCustomRateSubmit(e.target.value)
								}
								onKeyDown={(e) => {
									if (
										e.key.length === 1 &&
										!/[\d.]/.test(e.key) &&
										!e.metaKey &&
										!e.ctrlKey
									)
										flashInvalidRate();
								}}
								placeholder="Enter rate"
								step="0.00000001"
								type="number"
								value={customInputValue}
							/>
							{invalidRateWarn && (
								<span className="text-amber-500 text-xs">
									Numbers only
								</span>
							)}
						</div>
					)}

					{/* Bottom row: home currency + converted amount */}
					<div className="flex h-9 items-center border-t border-input bg-muted/20">
						<div className="flex shrink-0 items-center gap-1.5 border-r border-input px-3">
							<CurrencyFlag
								className="h-4 w-4"
								currencyCode={homeCurrency}
							/>
							<span className="text-muted-foreground text-sm font-medium">
								{homeCurrency}
							</span>
						</div>
						<div className="flex flex-1 items-center px-3">
							<span
								className={cn(
									"tabular-nums text-sm transition-all duration-150",
									errors.amountInUSD
										? "text-destructive"
										: "text-foreground",
									(!convertedAmount || convertedAmount === 0) &&
										"text-muted-foreground",
								)}
							>
								{getCurrencySymbol(homeCurrency)}
								{formatConvertedAmount(convertedAmount)}
							</span>
						</div>
						<span className="hidden pr-3 text-muted-foreground text-sm sm:block">
							In budget as
						</span>
					</div>
				</div>
			)}

			{invalidCharWarn && (
				<p className="text-amber-500 text-xs">
					Only digits and operators (+ − * /) are allowed
				</p>
			)}
			{errors.amount && (
				<p className="text-destructive text-sm">{errors.amount.message}</p>
			)}
			{errors.currency && (
				<p className="text-destructive text-sm">
					{errors.currency.message}
				</p>
			)}
			{amountHint && !watchedAmount && (
				<p className="animate-in fade-in text-muted-foreground text-xs duration-150">
					Last time: {getCurrencySymbol(amountHint.currency)}{formatNumber(amountHint.amount, getDecimalDigits(amountHint.currency))}
				</p>
			)}
		</div>
	);
}

// --- Sub-components ---

interface RateSegmentStripProps {
	rateOptions: { type: string; rate: number; label: string }[];
	selectedType: string;
	onSelect: (type: string) => void;
	formatRate: (rate: number) => string;
	getDisplayRateValue: (dbRate: number) => number;
	getPreviewAmount: (dbRate: number) => number;
	homeCurrency: string;
	isCrypto: boolean;
	customInputValue: string;
	onCustomRateChange: (value: string) => void;
	showCustomInput: boolean;
	getCurrencySymbol: (currency: string) => string;
}

function RateSegmentStrip({
	rateOptions,
	selectedType,
	onSelect,
	formatRate,
	getDisplayRateValue,
	getPreviewAmount,
	homeCurrency,
	isCrypto,
	showCustomInput,
	getCurrencySymbol,
}: RateSegmentStripProps) {
	return (
		<div className="flex overflow-x-auto">
			{rateOptions.map((option, i) => {
				const isSelected = selectedType === option.type;
				const displayRate = getDisplayRateValue(option.rate);
				const preview = getPreviewAmount(option.rate);

				return (
					<button
						className={cn(
							"flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 px-2 py-1.5 transition-colors",
							i < rateOptions.length - 1 &&
								"border-r border-input",
							isSelected
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-muted/60",
						)}
						key={option.type}
						onClick={() => onSelect(option.type)}
						type="button"
					>
						<span className="text-xs font-medium leading-tight">
							{getRateTypeLabel(option.type)}
						</span>
						<span className="text-sm tabular-nums leading-tight">
							{formatRate(displayRate)}
						</span>
						{preview > 0 && (
							<span className="text-xs tabular-nums text-muted-foreground leading-tight">
								{"\u2248"} {getCurrencySymbol(homeCurrency)}
								{formatNumber(preview, 2)}
							</span>
						)}
					</button>
				);
			})}
			{/* Custom segment */}
			<button
				className={cn(
					"flex min-w-0 flex-shrink-0 cursor-pointer flex-col items-center gap-0.5 px-2 py-1.5 transition-colors",
					selectedType === "custom"
						? "bg-primary/10 text-primary"
						: "text-muted-foreground hover:bg-muted/60",
				)}
				onClick={() => onSelect("custom")}
				type="button"
			>
				<span className="text-xs font-medium leading-tight">
					Custom
				</span>
				<span className="flex items-center gap-0.5 text-sm tabular-nums leading-tight">
					<Pencil className="h-3 w-3" />
					{showCustomInput ? "..." : "Set"}
				</span>
			</button>
		</div>
	);
}

interface NoRateAvailableProps {
	customInputValue: string;
	onCustomRateChange: (value: string) => void;
	setIsCustomRateSet: (v: boolean) => void;
	setSelectedRateType: (type: string) => void;
	setShowCustomInput: (v: boolean) => void;
}

function NoRateAvailable({
	customInputValue,
	onCustomRateChange,
	setIsCustomRateSet,
	setSelectedRateType,
	setShowCustomInput,
}: NoRateAvailableProps) {
	const [showInput, setShowInput] = useState(false);
	const [invalidWarn, setInvalidWarn] = useState(false);
	const invalidWarnTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const flashWarn = () => {
		setInvalidWarn(true);
		clearTimeout(invalidWarnTimer.current);
		invalidWarnTimer.current = setTimeout(() => setInvalidWarn(false), 1500);
	};

	if (!showInput) {
		return (
			<button
				className="cursor-pointer text-sm text-muted-foreground underline decoration-dashed underline-offset-2 hover:text-foreground"
				onClick={() => {
					setShowInput(true);
					setIsCustomRateSet(true);
					setSelectedRateType("custom");
					setShowCustomInput(true);
				}}
				type="button"
			>
				No rate available. Enter custom rate.
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<span className="shrink-0 text-muted-foreground text-sm">
				Rate:
			</span>
			<Input
				autoFocus
				className="h-7 w-28 border-input bg-transparent px-2 py-0 text-sm tabular-nums shadow-none focus-visible:ring-1 dark:bg-transparent"
				onChange={(e) => onCustomRateChange(e.target.value)}
				onKeyDown={(e) => {
					if (
						e.key.length === 1 &&
						!/[\d.]/.test(e.key) &&
						!e.metaKey &&
						!e.ctrlKey
					)
						flashWarn();
				}}
				placeholder="Enter rate"
				step="0.00000001"
				type="number"
				value={customInputValue}
			/>
			{invalidWarn && (
				<span className="text-amber-500 text-xs">Numbers only</span>
			)}
		</div>
	);
}

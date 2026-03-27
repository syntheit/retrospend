"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatNumber, getDecimalDigits } from "~/lib/currency-format";

interface UseCurrencyInputOptions {
	value: number;
	onChange: (value: number) => void;
	currency?: string;
	decimals?: number;
	formatOnBlur?: boolean;
}

export function useCurrencyInput({
	value,
	onChange,
	currency,
	decimals,
	formatOnBlur = true,
}: UseCurrencyInputOptions) {
	const resolvedDecimals = decimals ?? (currency ? getDecimalDigits(currency) : 2);
	const focusedRef = useRef(false);

	const formatValue = useCallback(
		(num: number) => {
			if (num === 0) return "";
			return formatNumber(num, resolvedDecimals);
		},
		[resolvedDecimals],
	);

	const [displayValue, setDisplayValue] = useState(() =>
		value ? formatValue(value) : "",
	);

	// Sync external value changes when not focused
	useEffect(() => {
		if (focusedRef.current) return;
		setDisplayValue(value ? formatValue(value) : "");
	}, [value, formatValue]);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const raw = e.target.value;
			// Allow only digits, single decimal point, and empty string
			if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
			setDisplayValue(raw);
			const num = parseFloat(raw);
			if (!isNaN(num)) {
				onChange(num);
			} else if (raw === "" || raw === ".") {
				onChange(0);
			}
		},
		[onChange],
	);

	const handleFocus = useCallback(
		(e: React.FocusEvent<HTMLInputElement>) => {
			focusedRef.current = true;
			// Strip commas for editing
			setDisplayValue((prev) => prev.replace(/,/g, ""));
			// Select all text after stripping
			requestAnimationFrame(() => {
				e.target.select();
			});
		},
		[],
	);

	const handleBlur = useCallback(() => {
		focusedRef.current = false;
		if (!formatOnBlur) return;
		const num = parseFloat(displayValue.replace(/,/g, ""));
		if (!isNaN(num) && num > 0) {
			setDisplayValue(formatNumber(num, resolvedDecimals));
			onChange(num);
		} else {
			setDisplayValue("");
			onChange(0);
		}
	}, [displayValue, resolvedDecimals, formatOnBlur, onChange]);

	const inputProps = {
		value: displayValue,
		onChange: handleChange,
		onFocus: handleFocus,
		onBlur: handleBlur,
		type: "text" as const,
		inputMode: "decimal" as const,
	};

	return { displayValue, handleChange, handleFocus, handleBlur, inputProps };
}

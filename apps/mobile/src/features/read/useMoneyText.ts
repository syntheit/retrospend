import { useCallback } from "react";
import { type Money, type MoneyOptions, useFormatMoney } from "@/lib/money";

/**
 * The money formatter for money that is present: a string, always. (The
 * shared hook also answers null for missing money; screens that can have a
 * missing amount say so in words before they get here.)
 */
export function useMoneyText() {
	const { format } = useFormatMoney();
	return useCallback(
		(value: Money, options?: MoneyOptions): string =>
			format(value, options) ?? "",
		[format],
	);
}

import Image from "next/image";
import { getCountryCodeFromCurrency } from "~/lib/currency-to-country";
import { cn, isCrypto } from "~/lib/utils";
import { CryptoIcon } from "./crypto-icon";

interface CurrencyFlagProps {
	currencyCode: string;
	className?: string;
}

/**
 * CurrencyFlag component that displays a circular flag for a given currency code.
 * Replaced the previous implementation with local circular flags and added crypto support.
 */
export function CurrencyFlag({ currencyCode, className }: CurrencyFlagProps) {
	// Detect if it's a crypto currency
	const isCryptoCurrency = isCrypto(currencyCode);

	if (isCryptoCurrency) {
		return <CryptoIcon className={className} currencyCode={currencyCode} />;
	}

	const countryCode = getCountryCodeFromCurrency(currencyCode);

	if (!countryCode) {
		return (
			<div
				className={cn(
					"h-6 w-6 shrink-0 rounded-full border border-border/50 bg-muted",
					className,
				)}
			/>
		);
	}

	return (
		<div
			className={cn(
				"relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-border/50 bg-muted/20",
				className,
			)}
			title={currencyCode}
		>
			<Image
				alt={`${currencyCode} flag`}
				className="object-cover"
				fill
				sizes="24px"
				src={`/images/flags/${countryCode}.svg`}
			/>
		</div>
	);
}

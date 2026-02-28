import { Bitcoin, Coins } from "lucide-react";
import Image from "next/image";
import { getCountryCodeFromCurrency } from "~/lib/currency-to-country";
import { cn } from "~/lib/utils";

interface CurrencyFlagProps {
	currencyCode: string;
	className?: string;
}

/**
 * CurrencyFlag component that displays a circular flag for a given currency code.
 * Uses the circle-flags library via CDN for clean, flat, circular flags.
 */
export function CurrencyFlag({ currencyCode, className }: CurrencyFlagProps) {
	// Detect if it's a crypto currency
	const isCrypto =
		currencyCode === "BTC" ||
		currencyCode === "ETH" ||
		currencyCode.startsWith("X") ||
		currencyCode.length > 3;

	if (isCrypto) {
		return (
			<div
				className={cn(
					"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/30",
					currencyCode === "BTC"
						? "bg-orange-500/10 text-orange-500"
						: "bg-blue-500/10 text-blue-500",
					className,
				)}
			>
				{currencyCode === "BTC" ? (
					<Bitcoin className="h-4 w-4" />
				) : (
					<Coins className="h-4 w-4" />
				)}
			</div>
		);
	}

	const countryCode = getCountryCodeFromCurrency(currencyCode);

	if (!countryCode) {
		return (
			<div
				className={cn(
					"h-6 w-6 shrink-0 rounded-full bg-muted border border-border/50",
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

import { Bitcoin, Coins } from "lucide-react";
import { cn } from "~/lib/utils";

const CURRENCY_TO_FLAG: Record<string, string> = {
	USD: "us",
	EUR: "eu",
	GBP: "gb",
	ARS: "ar",
	BRL: "br",
	UYU: "uy",
	PYG: "py",
	CLP: "cl",
	CAD: "ca",
	AUD: "au",
	JPY: "jp",
	CNY: "cn",
	INR: "in",
	CHF: "ch",
	NZD: "nz",
	HKD: "hk",
	SGD: "sg",
};

interface CurrencyFlagProps {
	currencyCode: string;
	className?: string; // Allow passing className for additional styling if needed
}

export function CurrencyFlag({ currencyCode, className }: CurrencyFlagProps) {
	// Detect if it's a crypto currency or unknown fiat
	const isCrypto =
		!CURRENCY_TO_FLAG[currencyCode] &&
		(currencyCode.length > 3 || currencyCode.startsWith("X"));

	if (isCrypto || currencyCode === "BTC" || currencyCode === "ETH") {
		return (
			<div
				className={cn(
					"flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
					currencyCode === "BTC"
						? "bg-orange-500/10 text-orange-500"
						: "bg-blue-500/10 text-blue-500",
					className,
				)}
			>
				{currencyCode === "BTC" ? (
					<Bitcoin className="h-3.5 w-3.5" />
				) : (
					<Coins className="h-3.5 w-3.5" />
				)}
			</div>
		);
	}

	// Try explicit mapping first
	const code = CURRENCY_TO_FLAG[currencyCode];

	if (!code) {
		return (
			<span
				className={cn(
					"!h-6 !w-6 block rounded-full bg-muted shrink-0",
					className,
				)}
			/>
		);
	}

	return (
		<span
			className={cn(
				`fi fi-${code} fis`, // Added fis for 1x1 aspect ratio
				"!h-6 !w-6 rounded-full shadow-sm", // Force dimensions to override library styles
				className,
			)}
			title={currencyCode}
		/>
	);
}

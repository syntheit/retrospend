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
	const code = CURRENCY_TO_FLAG[currencyCode];

	if (currencyCode === "BTC") {
		return <Bitcoin className={cn("!h-6 !w-6 text-orange-500", className)} />;
	}

	if (currencyCode === "ETH") {
		return <Coins className={cn("!h-6 !w-6 text-gray-500", className)} />;
	}

	if (!code) {
		return (
			<span
				className={cn("!h-6 !w-6 block rounded-full bg-muted", className)}
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

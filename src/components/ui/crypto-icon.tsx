"use client";

import { Coins } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { SUPPORTED_CRYPTO_ICONS } from "~/lib/supported-crypto-icons";
import { cn } from "~/lib/utils";

interface CryptoIconProps {
	currencyCode: string;
	className?: string;
}

/**
 * CryptoIcon component that displays a circular icon for a given cryptocurrency code.
 * Uses the cryptocurrency-icons library.
 */
export function CryptoIcon({ currencyCode, className }: CryptoIconProps) {
	const [error, setError] = useState(false);
	const code = currencyCode.toUpperCase();
	const hasIcon = SUPPORTED_CRYPTO_ICONS.has(code);

	if (error || !hasIcon) {
		return (
			<div
				className={cn(
					"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/30 text-muted-foreground",
					className,
				)}
			>
				<Coins className="h-4 w-4" />
			</div>
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
				alt={`${currencyCode} icon`}
				className="object-cover"
				fill
				onError={() => setError(true)}
				sizes="24px"
				src={`/images/crypto/${code.toLowerCase()}.svg`}
			/>
		</div>
	);
}

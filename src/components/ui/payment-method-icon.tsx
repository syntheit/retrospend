"use client";

import {
	Banknote,
	Bitcoin,
	Coins,
	CreditCard,
	Landmark,
	type LucideIcon,
	QrCode,
	Wallet,
} from "lucide-react";
import { cn } from "~/lib/cn";
import {
	getMethodType,
	resolveMethodTypeId,
} from "~/lib/payment-method-registry";
import { CurrencyFlag } from "./currency-flag";

const SIZE = {
	sm: "size-4",
	md: "size-5",
	lg: "size-6",
} as const;

/** What kind of way to pay it is: a bare glyph, never a brand-colored disc. */
function glyphFor(typeId: string, category: string | undefined): LucideIcon {
	if (typeId === "crypto_btc") return Bitcoin;
	if (typeId === "pix") return QrCode;
	if (typeId === "custom") return CreditCard;
	switch (category) {
		case "bank":
			return Landmark;
		case "cash":
			return Banknote;
		case "crypto":
			return Coins;
		default:
			return Wallet;
	}
}

interface PaymentMethodIconProps {
	typeId: string;
	currency?: string | null;
	size?: "sm" | "md" | "lg";
	className?: string;
}

/**
 * Payment method identity: a bare glyph for the kind (wallet, bank, coins,
 * cash), in the secondary text color. Cash in a known currency shows that
 * currency's flag. The platform's name sits next to it, so no logo.
 */
export function PaymentMethodIcon({
	typeId,
	currency,
	size = "md",
	className,
}: PaymentMethodIconProps) {
	const resolvedId = resolveMethodTypeId(typeId, currency);
	const def = getMethodType(resolvedId);

	if (def?.category === "cash" && currency) {
		return (
			<CurrencyFlag
				className={cn("shrink-0", SIZE[size], className)}
				currencyCode={currency}
			/>
		);
	}

	const Glyph = glyphFor(resolvedId, def?.category);
	return (
		<Glyph
			aria-hidden="true"
			className={cn("shrink-0 text-fg-2", SIZE[size], className)}
			strokeWidth={1.75}
		/>
	);
}

/** Thin helper: resolve display name from registry, falling back to label or raw type */
export function getPaymentMethodName(
	typeId: string,
	label?: string | null,
	currency?: string | null,
): string {
	if (label) return label;
	const resolved = resolveMethodTypeId(typeId, currency);
	const def = getMethodType(resolved);
	if (def) {
		if (def.category === "cash" && currency) return `Cash · ${currency}`;
		return def.name;
	}
	return typeId.charAt(0).toUpperCase() + typeId.slice(1);
}

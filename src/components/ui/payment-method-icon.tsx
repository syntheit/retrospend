"use client";

import Image from "next/image";
import { cn } from "~/lib/utils";
import {
	getMethodIcon,
	getMethodType,
	resolveMethodTypeId,
} from "~/lib/payment-method-registry";
import { CurrencyFlag } from "./currency-flag";

const SIZE_MAP = {
	sm: { circle: 28, icon: 16, text: "text-[10px]", flagClass: "h-7 w-7" },
	md: { circle: 36, icon: 20, text: "text-xs", flagClass: "h-9 w-9" },
	lg: { circle: 44, icon: 24, text: "text-sm", flagClass: "h-11 w-11" },
} as const;

interface PaymentMethodIconProps {
	typeId: string;
	currency?: string | null;
	size?: "sm" | "md" | "lg";
	className?: string;
}

export function PaymentMethodIcon({
	typeId,
	currency,
	size = "md",
	className,
}: PaymentMethodIconProps) {
	const resolvedId = resolveMethodTypeId(typeId, currency);
	const methodDef = getMethodType(resolvedId);
	const icon = getMethodIcon(resolvedId);
	const { circle, icon: iconSize, text, flagClass } = SIZE_MAP[size];

	// For cash methods with a known currency, show the currency flag instead of "C"
	if (methodDef?.category === "cash" && currency) {
		return <CurrencyFlag className={cn(flagClass, className)} currencyCode={currency} />;
	}

	if (icon.src) {
		const isCryptoIcon = icon.src.startsWith("/images/crypto/");

		if (isCryptoIcon) {
			// Crypto icons are multi-color branded SVGs - render as-is in a neutral dark circle
			return (
				<span
					className={cn(
						"inline-flex shrink-0 items-center justify-center rounded-full",
						className,
					)}
					style={{
						backgroundColor: "#1a1a2e",
						width: circle,
						height: circle,
					}}
				>
					<Image
						alt=""
						height={iconSize}
						src={icon.src}
						width={iconSize}
					/>
				</span>
			);
		}

		// Platform icons are monochrome SVGs - force white via CSS filter inside brand color circle
		return (
			<span
				className={cn(
					"inline-flex shrink-0 items-center justify-center rounded-full",
					className,
				)}
				style={{
					backgroundColor: icon.fallbackColor,
					width: circle,
					height: circle,
				}}
			>
				<Image
					alt=""
					className="brightness-0 invert"
					height={iconSize}
					src={icon.src}
					width={iconSize}
				/>
			</span>
		);
	}

	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
				text,
				className,
			)}
			style={{
				backgroundColor: icon.fallbackColor,
				width: circle,
				height: circle,
			}}
		>
			{icon.fallbackLetter}
		</span>
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

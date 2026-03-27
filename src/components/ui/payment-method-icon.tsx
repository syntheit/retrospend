"use client";

import Image from "next/image";
import { cn } from "~/lib/utils";
import {
	getMethodIcon,
	getMethodType,
	resolveMethodTypeId,
} from "~/lib/payment-method-registry";

const SIZE_MAP = {
	sm: { circle: 28, icon: 16, text: "text-[10px]" },
	md: { circle: 36, icon: 20, text: "text-xs" },
	lg: { circle: 44, icon: 24, text: "text-sm" },
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
	const icon = getMethodIcon(resolvedId);
	const { circle, icon: iconSize, text } = SIZE_MAP[size];

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
	if (def) return def.name;
	return typeId.charAt(0).toUpperCase() + typeId.slice(1);
}

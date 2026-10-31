"use client";

import Image from "next/image";
import {
	type AccountIcon,
	brandBySlug,
	brandUsesOwnColor,
	isMonogramSlot,
	MONOGRAM_BG,
	monogramLetter,
} from "~/lib/account-icons";
import { cn } from "~/lib/cn";

/**
 * The mark beside an account: a bundled logo drawn in its own color (asset
 * data, not a UI token; a near black or near white logo takes the text color
 * so it stays visible in both themes), the first letter of the name on a
 * palette color, or the person's own picture.
 *
 * "row" is the 32px tile of a list row (the one lead the row has). "menu" is
 * the bare 16px mark in a picker or menu, in the lead slot where a flag sat.
 * Decorative: the name is always written next to it.
 */
export function AccountMark({
	icon,
	name,
	size = "row",
}: {
	icon: AccountIcon;
	name: string;
	size?: "row" | "menu";
}) {
	const row = size === "row";
	const box = row ? "size-8 rounded-ctl" : "size-4 rounded-chip";
	const inner = row ? "size-5" : "size-4";
	const base = "inline-flex shrink-0 items-center justify-center";

	if (icon.kind === "BRAND") {
		const brand = brandBySlug(icon.value);
		if (!brand) return null;
		const own = brandUsesOwnColor(brand.hex);
		return (
			<span
				aria-hidden="true"
				className={cn(base, "text-fg-2", row && "bg-raised", box)}
			>
				<svg
					aria-hidden="true"
					className={cn(inner, !own && "fill-current")}
					focusable="false"
					style={own ? { fill: `#${brand.hex}` } : undefined}
					viewBox="0 0 24 24"
				>
					<path d={brand.path} />
				</svg>
			</span>
		);
	}

	if (icon.kind === "MONOGRAM") {
		const slot = isMonogramSlot(icon.value) ? icon.value : "avatar-1";
		return (
			<span
				aria-hidden="true"
				className={cn(
					base,
					"text-avatar-fg font-medium",
					row ? "text-small" : "text-meta",
					MONOGRAM_BG[slot],
					box,
				)}
			>
				{monogramLetter(name)}
			</span>
		);
	}

	return (
		<span
			aria-hidden="true"
			className={cn(base, "overflow-hidden", row && "bg-raised", box)}
		>
			<Image
				alt=""
				className="size-full object-contain"
				height={row ? 32 : 16}
				src={icon.value}
				unoptimized
				width={row ? 32 : 16}
			/>
		</span>
	);
}

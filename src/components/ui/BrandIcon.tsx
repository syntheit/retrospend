"use client";

import { CreditCard } from "lucide-react";
import { cn } from "~/lib/utils";

interface BrandIconProps {
	name: string;
	url?: string | null;
	size?: number;
	className?: string;
}

export function BrandIcon({ name, size = 40, className }: BrandIconProps) {
	return (
		<div
			className={cn(
				"flex items-center justify-center bg-stone-800 text-stone-200 rounded-md shrink-0",
				className,
			)}
			style={{ width: size, height: size }}
			title={name}
		>
			{name ? (
				<span className="font-bold text-sm uppercase">{name.charAt(0)}</span>
			) : (
				<CreditCard className="h-1/2 w-1/2 opacity-50" />
			)}
		</div>
	);
}

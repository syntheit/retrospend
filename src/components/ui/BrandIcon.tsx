"use client";

import { CreditCard } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";

interface BrandIconProps {
	name: string;
	url?: string | null;
	size?: number;
	className?: string;
}

/**
 * Helper to extract a clean domain name for Brandfetch.
 * Returns a clean hostname (e.g., "spotify.com") without protocols or paths.
 */
function getDomain(name: string, url?: string | null): string {
	// Priority 1: Extract from explicit URL
	if (url) {
		try {
			const hostname = new URL(url).hostname;
			return hostname.replace(/^www\./, "");
		} catch (_) {
			// Invalid URL, fall through
		}
	}

	// Priority 2: Fallback to name-based guess
	// "YouTube Music" -> "youtubemusic.com"
	const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
	return `${cleanName}.com`;
}

export function BrandIcon({ name, url, size = 40, className }: BrandIconProps) {
	const [hasError, setHasError] = useState(false);

	// Reset error state if props change drastically (optional, but good practice)
	// identifying domain changes
	const domain = getDomain(name, url);

	// Use our local API proxy to bypass CORS/hotlinking restrictions
	const imageUrl = `/api/brand-icon?domain=${encodeURIComponent(domain)}&size=${size * 2}`;

	if (hasError) {
		return (
			<div
				className={cn(
					"flex items-center justify-center bg-stone-800 text-stone-200",
					className,
				)}
				style={{ width: size, height: size }}
				title={name}
			>
				{/* Try to show first letter, else generic icon */}
				{name ? (
					<span className="font-bold text-sm uppercase">{name.charAt(0)}</span>
				) : (
					<CreditCard className="h-1/2 w-1/2 opacity-50" />
				)}
			</div>
		);
	}

	return (
		<div
			className={cn("relative overflow-hidden bg-white/5", className)}
			style={{ width: size, height: size }}
		>
			<img
				alt={`${name} logo`}
				className="h-full w-full object-cover"
				crossOrigin="anonymous"
				onError={() => setHasError(true)}
				referrerPolicy="no-referrer"
				src={imageUrl}
			/>
		</div>
	);
}

"use client";

import Image from "next/image";

/**
 * A project's cover photo for a row's or header's cover slot. Covers are
 * content (N41): only a photo the user set shows; without one the slot
 * stays the kit's flat tile (no generated scenes, TELLS #16).
 */
export function ProjectCover({ src }: { src: string | null }) {
	if (!src) return null;
	return (
		<Image
			alt=""
			className="object-cover"
			height={48}
			src={src}
			unoptimized
			width={48}
		/>
	);
}

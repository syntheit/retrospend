"use client";

import { categoryTone } from "@retrospend/domain/category-tone";
import { CategoryTile } from "~/components/ui/category-badge";
import type { EnvelopeInGroup } from "./use-month";

/** An envelope's identity in a sheet row: its tile, in the envelope's color. */
export function EnvelopeTile({
	envelope,
}: {
	envelope: Pick<EnvelopeInGroup, "name" | "icon" | "color">;
}) {
	return (
		<CategoryTile
			category={{
				name: envelope.name,
				icon: envelope.icon,
				tone: categoryTone(envelope.color ?? ""),
			}}
		/>
	);
}

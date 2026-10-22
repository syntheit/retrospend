"use client";

import { useTranslations } from "next-intl";
import { STATUS, type StatusKind, toneOf } from "~/components/ui/status-map";
import { cn } from "~/lib/cn";

/** The translated word of a status kind. */
export function useStatusWord(): (kind: StatusKind) => string {
	const t = useTranslations("kit.status");
	return (kind) => t(STATUS[kind].word);
}

/** StatusDot (R5): a status kind as a dot plus its word, never color alone. */
export function StatusDot({
	kind,
	label,
	size = "default",
	className,
}: {
	kind: StatusKind;
	/** Overrides the map's word with a more specific one ("Overdue since Oct 3"). */
	label?: string;
	size?: "default" | "sm";
	className?: string;
}) {
	const word = useStatusWord();
	const tone = toneOf(kind);
	return (
		<span
			className={cn(
				"inline-flex items-center gap-2 whitespace-nowrap",
				size === "sm" ? "text-meta" : "text-small",
				tone.text,
				className,
			)}
			data-status={kind}
		>
			<span
				aria-hidden="true"
				className={cn("size-2 shrink-0 rounded-full", tone.dot)}
			/>
			{label ?? word(kind)}
		</span>
	);
}

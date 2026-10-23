"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/cn";
import type { SectionId } from "./sections";

/**
 * One Settings section (mockup .sset): flat, a 16/600 heading with an
 * optional action at its end, 48 between sections. The id is the anchor
 * the section nav and `/settings#<id>` scroll to.
 */
export function SectionShell({
	id,
	title,
	action,
	children,
}: {
	id: SectionId;
	title: string;
	/** One small secondary Button beside the heading (Add category). */
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="mt-12 scroll-mt-4 first:mt-0 max-md:scroll-mt-14"
			data-section={id}
			id={id}
		>
			<div className="mb-2 flex min-h-ctl items-center gap-3">
				{/* The section nav moves focus here (tabIndex -1: focusable by script, not by Tab). */}
				<h2
					className="flex-1 rounded-ctl text-fg text-section outline-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
					id={`${id}-title`}
					tabIndex={-1}
				>
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/** A section's read failed: say so, with Retry (R14). */
export function SectionUnavailable({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations("settingsV2.states");
	return (
		<Empty
			action={
				<Button kind="secondary" onClick={onRetry} size="sm">
					{t("retry")}
				</Button>
			}
			className="py-6"
			title={t("unavailable")}
		/>
	);
}

/** Loading settings rows: a label line and a control, at row height. */
export function SkeletonRowsFor({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	return (
		<div aria-busy="true" className={cn("flex flex-col", className)}>
			{Array.from({ length: count }, (_, i) => (
				<div
					className="flex min-h-13 items-center gap-3 border-line border-t py-2 first:border-t-0"
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					key={i}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="w-1/3" shape="line" />
						<Skeleton className="w-1/2" shape="line" />
					</div>
					<Skeleton className="h-8 w-24 rounded-ctl" shape="line" />
				</div>
			))}
		</div>
	);
}

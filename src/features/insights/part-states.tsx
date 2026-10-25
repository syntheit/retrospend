"use client";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";

/** What a part needs of its read: the answer, its state and a retry. */
export type PartQuery<T> = {
	data: T | undefined;
	isPending: boolean;
	isError: boolean;
	refetch: () => unknown;
};

/** One part of Insights could not load: say so with a retry, never zeros. */
export function PartUnavailable({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations("insights.unavailable");
	return (
		<Empty
			action={
				<Button kind="secondary" onClick={onRetry} size="sm">
					{t("retry")}
				</Button>
			}
			className="py-8"
			hint={t("hint")}
			icon={CloudOff}
			title={t("title")}
		/>
	);
}

/** Ranked rows in place while they load: a label, an amount, a bar. */
export function RankedSkeleton({ rows = 5 }: { rows?: number }) {
	return (
		<div aria-busy="true" className="flex flex-col gap-3">
			{Array.from({ length: rows }, (_, i) => (
				<div
					className="flex flex-col gap-1"
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
					key={i}
				>
					<div className="flex items-center justify-between gap-3">
						<Skeleton className="w-32" shape="line" />
						<Skeleton shape="money" />
					</div>
					<Skeleton className="rounded-chip h-2" shape="line" />
				</div>
			))}
		</div>
	);
}

/** The hero and its sentence while they load. */
export function LeadSkeleton() {
	return (
		<div aria-busy="true" className="mb-8 flex flex-col gap-2">
			<Skeleton className="rounded-chip h-6 w-48" shape="line" />
			<Skeleton className="w-80 max-w-full" shape="line" />
		</div>
	);
}

/** The page in place before it hydrates: the lead, then the rows of the first column. */
export function InsightsSkeleton() {
	return (
		<>
			<LeadSkeleton />
			<RankedSkeleton rows={6} />
		</>
	);
}

/** A chart's height in place while it loads. */
export function ChartSkeleton({ height }: { height: number }) {
	return (
		<Skeleton className="rounded-ctl w-full" shape="line" style={{ height }} />
	);
}

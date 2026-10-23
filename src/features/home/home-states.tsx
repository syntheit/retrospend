"use client";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";
import { PageFrame } from "~/features/wealth/page-frame";

/** The glance in place while it loads: label, hero, line. */
export function GlanceSkeleton() {
	return (
		<div aria-busy="true" className="flex flex-col gap-2">
			<Skeleton className="w-24" shape="line" />
			<Skeleton className="rounded-chip h-8 w-56" shape="line" />
			<Skeleton className="w-48" shape="line" />
		</div>
	);
}

/** Loading (R14): skeleton rows that match the glance, Needs you and Recent. */
export function HomeSkeleton() {
	const t = useTranslations("homePage");
	return (
		<PageFrame label="home">
			<PageHeader title={t("title")} />
			<GlanceSkeleton />
			<SkeletonRows className="mt-8" count={4} />
			<SkeletonRows className="mt-8" count={5} />
		</PageFrame>
	);
}

/** One part of Home could not load: say so with a retry, never zeros. */
export function PartUnavailable({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations("homePage.unavailable");
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

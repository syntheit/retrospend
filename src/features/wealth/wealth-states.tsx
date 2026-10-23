"use client";

import { CloudOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";

/** Loading (R14): the hero, the chart and the rows in place. */
export function WealthSkeleton() {
	const t = useTranslations("wealthPage");
	return (
		<PageFrame label="wealth">
			<PageHeader title={t("title")} />
			<div aria-busy="true" className="flex flex-col gap-2">
				<Skeleton className="w-24" shape="line" />
				<Skeleton className="rounded-chip h-8 w-64" shape="line" />
				<Skeleton className="w-48" shape="line" />
				<Skeleton className="rounded-panel mt-4 h-56" shape="line" />
			</div>
			<SkeletonRows className="mt-8" count={6} />
		</PageFrame>
	);
}

/** Unavailable (R14): the read failed; say so and offer a retry, never zeros. */
export function WealthUnavailable() {
	const t = useTranslations("wealthPage");
	const router = useRouter();
	return (
		<PageFrame label="wealth">
			<PageHeader title={t("title")} />
			<Empty
				action={
					<Button kind="secondary" onClick={() => router.refresh()} size="sm">
						{t("unavailable.retry")}
					</Button>
				}
				hint={t("unavailable.hint")}
				icon={CloudOff}
				title={t("unavailable.title")}
			/>
		</PageFrame>
	);
}

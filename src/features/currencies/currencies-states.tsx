"use client";

import { CloudOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";

/** Loading (R14): the rows in place. */
export function CurrenciesSkeleton() {
	const t = useTranslations("currenciesPage");
	return (
		<PageFrame label="currencies">
			<PageHeader title={t("title")} />
			<SkeletonRows count={8} />
		</PageFrame>
	);
}

/** Unavailable (R14): the rates could not be read; never a 1 or a 0 in their place. */
export function CurrenciesUnavailable() {
	const t = useTranslations("currenciesPage");
	const router = useRouter();
	return (
		<PageFrame label="currencies">
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

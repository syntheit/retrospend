"use client";

import { CloudOff, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";
import { PageFrame } from "~/features/wealth/page-frame";

/** Loading (R14): the standing block and the rows, at their real height. */
export function PeopleSkeleton() {
	const t = useTranslations("peoplePage");
	return (
		<PageFrame label="people">
			<PageHeader title={t("title")} />
			<div aria-busy="true" className="mb-8 flex flex-col gap-2">
				<Skeleton className="w-24" shape="line" />
				<Skeleton className="rounded-chip h-8 w-64" shape="line" />
				<Skeleton className="rounded-chip mt-12 h-3 w-full" shape="line" />
			</div>
			<SkeletonRows count={6} />
		</PageFrame>
	);
}

/** Nobody shared with yet: one line and the two ways to start. */
export function PeopleEmpty({
	onAddExpense,
	onAddPerson,
}: {
	onAddExpense: () => void;
	onAddPerson: () => void;
}) {
	const t = useTranslations("peoplePage.empty");
	return (
		<Empty
			action={
				<div className="flex flex-wrap justify-center gap-2">
					<Button kind="primary" onClick={onAddExpense} size="sm">
						{t("addExpense")}
					</Button>
					<Button kind="secondary" onClick={onAddPerson} size="sm">
						{t("addPerson")}
					</Button>
				</div>
			}
			icon={Users}
			title={t("title")}
		/>
	);
}

/** Unavailable (R14): the read failed; say so and offer a retry, never zeros. */
export function PeopleUnavailable() {
	const t = useTranslations("peoplePage");
	const router = useRouter();
	return (
		<PageFrame label="people">
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

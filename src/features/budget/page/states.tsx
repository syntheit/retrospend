"use client";

import { CloudOff, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";

/** Hero and rows at their real height, so nothing jumps when data arrives (R14). */
export function BudgetSkeleton() {
	return (
		<div aria-busy="true" data-slot="budget-skeleton">
			<div className="mb-6">
				<Skeleton className="mb-2 w-32" shape="line" />
				<Skeleton className="mb-3 h-8 w-56" shape="money" />
				<Skeleton className="w-2/3" shape="line" />
			</div>
			<SkeletonRows count={8} />
		</div>
	);
}

/** The read failed; nothing is guessed (R14). */
export function BudgetUnavailable({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations("budgetPage.unavailable");
	return (
		<Empty
			action={
				<Button kind="secondary" onClick={onRetry} size="sm">
					{t("retry")}
				</Button>
			}
			hint={t("hint")}
			icon={CloudOff}
			title={t("title")}
		/>
	);
}

/** No budget yet: setup is a sheet, so this only hands off to it. */
export function BudgetEmpty({
	onSetup,
}: {
	onSetup: (() => void) | undefined;
}) {
	const t = useTranslations("budgetPage.empty");
	return (
		<Empty
			action={
				onSetup && (
					<Button kind="primary" onClick={onSetup} size="sm">
						{t("setup")}
					</Button>
				)
			}
			hint={t("hint")}
			icon={Wallet}
			title={t("title")}
		/>
	);
}

/** Switched to Just track: no envelopes are shown until the budget resumes. */
export function BudgetPaused({
	onResume,
	resuming,
}: {
	onResume: () => void;
	resuming: boolean;
}) {
	const t = useTranslations("budgetPage.paused");
	return (
		<Empty
			action={
				<Button kind="primary" loading={resuming} onClick={onResume} size="sm">
					{t("resume")}
				</Button>
			}
			hint={t("hint")}
			icon={Wallet}
			title={t("title")}
		/>
	);
}

"use client";

import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import type { ImportSummary } from "~/server/services/import/commit.mutation";
import { activityHref } from "./links";

/**
 * Done (import.html step 4): what was imported and what was skipped, View in
 * Activity on the days the rows landed on, and Undo import for the whole
 * batch. "Review N" waits for a review state on rows (GAPS).
 */
export function DoneStep({
	summary,
	undoing,
	onUndo,
	onAgain,
}: {
	summary: ImportSummary;
	undoing: boolean;
	onUndo: () => void;
	onAgain: () => void;
}) {
	const t = useTranslations("importPage.done");
	const router = useRouter();
	const s = summary;
	const hint = [
		s.duplicates ? t("dups", { count: s.duplicates }) : null,
		t("reconcile", { rows: s.fileRows, created: s.created }),
	]
		.filter(Boolean)
		.join(" ");
	return (
		<div className="max-w-190" data-testid="import-done">
			<Empty
				action={
					<div className="mt-2 flex flex-col items-center gap-2">
						<div className="flex flex-wrap justify-center gap-2">
							{s.from && s.to ? (
								<Button
									kind="primary"
									onClick={() =>
										router.push(activityHref(s.from ?? "", s.to ?? ""))
									}
								>
									{t("view")}
								</Button>
							) : null}
							<Button kind="ghost" loading={undoing} onClick={onUndo}>
								{t("undo")}
							</Button>
						</div>
						<Button kind="ghost" onClick={onAgain} size="sm">
							{t("again")}
						</Button>
					</div>
				}
				hint={hint}
				icon={CircleCheck}
				title={t("title", { count: s.created })}
			/>
		</div>
	);
}

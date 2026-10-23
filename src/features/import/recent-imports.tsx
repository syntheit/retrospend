"use client";

import { FileText, FileX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Section } from "~/components/layout/section";
import { useRowDates } from "~/components/rows/dates";
import { Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Notice } from "~/components/ui/notice";
import { Progress } from "~/components/ui/progress";
import { SkeletonRows } from "~/components/ui/skeleton";
import { StatusDot } from "~/components/ui/status-dot";
import { UNDO_TOAST_MS, useToast } from "~/components/ui/toast";
import type { RecentImport } from "~/server/services/import/recent";
import { api } from "~/trpc/react";
import { activityHref } from "./links";

function Status({ job }: { job: RecentImport }) {
	const t = useTranslations("importPage.recent");
	const { short } = useRowDates();
	switch (job.state) {
		case "reading":
			return (
				<StatusDot
					kind="importing"
					label={
						job.queued
							? t("queued")
							: job.percent != null
								? t("reading", { percent: job.percent })
								: t("readingNoPercent")
					}
					size="sm"
				/>
			);
		case "review":
			return (
				<StatusDot
					kind="review"
					label={t("review", { count: job.count })}
					size="sm"
				/>
			);
		case "failed":
			return <StatusDot kind="error" label={t("failed")} size="sm" />;
		default:
			return (
				<span className="text-fg-2 text-small">
					{job.to
						? t("imported", { count: job.count, date: short(job.to) })
						: t("importedNoDate", { count: job.count })}
				</span>
			);
	}
}

/**
 * Recent imports (import.html step 1): one status per job and its one
 * action. A delete hides the row at once and happens when its Undo toast is
 * gone, so Undo brings it back (R15).
 */
export function RecentImports({
	jobs,
	loading,
	failed,
	onReview,
}: {
	jobs: readonly RecentImport[] | undefined;
	loading: boolean;
	failed: boolean;
	onReview: (job: RecentImport) => void;
}) {
	const t = useTranslations("importPage.recent");
	const toast = useToast();
	const router = useRouter();
	const utils = api.useUtils();
	const cancel = api.importQueue.cancelJob.useMutation({
		onSuccess: () => void utils.importQueue.recent.invalidate(),
	});
	const remove = api.importQueue.deleteJob.useMutation({
		onSuccess: () => void utils.importQueue.recent.invalidate(),
	});
	const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	useEffect(() => {
		const pending = timers.current;
		return () => {
			for (const timer of pending.values()) clearTimeout(timer);
		};
	}, []);

	const hide = (id: string, on: boolean) =>
		setHidden((h) => {
			const next = new Set(h);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});
	const deleteLater = (job: RecentImport) => {
		hide(job.id, true);
		timers.current.set(
			job.id,
			setTimeout(() => remove.mutate({ jobId: job.id }), UNDO_TOAST_MS),
		);
		toast.saved(t("deleted", { name: job.fileName }), {
			undo: () => {
				clearTimeout(timers.current.get(job.id));
				timers.current.delete(job.id);
				hide(job.id, false);
			},
		});
	};

	const action = (job: RecentImport) => {
		switch (job.state) {
			case "reading":
				return job.queued ? (
					<Button
						kind="ghost"
						loading={cancel.isPending && cancel.variables?.jobId === job.id}
						onClick={() =>
							cancel.mutate(
								{ jobId: job.id },
								{
									onSuccess: () =>
										toast.info(t("cancelled", { name: job.fileName })),
								},
							)
						}
						size="sm"
					>
						{t("cancel")}
					</Button>
				) : null;
			case "review":
				return (
					<Button kind="secondary" onClick={() => onReview(job)} size="sm">
						{t("reviewAction", { count: job.count })}
					</Button>
				);
			case "failed":
				return (
					<Button kind="ghost" onClick={() => deleteLater(job)} size="sm">
						{t("delete")}
					</Button>
				);
			default:
				return job.from && job.to ? (
					<Button
						kind="ghost"
						onClick={() =>
							router.push(activityHref(job.from ?? "", job.to ?? ""))
						}
						size="sm"
					>
						{t("view")}
					</Button>
				) : null;
		}
	};

	const shown = (jobs ?? []).filter((j) => !hidden.has(j.id));
	if (!loading && !failed && shown.length === 0) return null;
	return (
		<Section
			className="mt-8"
			count={shown.length}
			id="recent"
			title={t("title")}
		>
			{failed ? (
				<Notice tone="danger">{t("couldNotLoad")}</Notice>
			) : loading ? (
				<SkeletonRows count={2} />
			) : (
				<RowList label={t("title")}>
					{shown.map((job) => (
						<Row
							data-job={job.id}
							end={action(job)}
							key={job.id}
							lead={
								job.state === "failed" ? (
									<FileX aria-hidden="true" className="text-fg-3 size-4" />
								) : (
									<FileText aria-hidden="true" className="text-fg-3 size-4" />
								)
							}
							sub={
								<div className="flex flex-col gap-1">
									<Status job={job} />
									{job.state === "reading" && job.percent != null ? (
										<Progress
											aria-label={t("reading", { percent: job.percent })}
											value={job.percent}
										/>
									) : null}
								</div>
							}
							title={job.fileName}
						/>
					))}
				</RowList>
			)}
		</Section>
	);
}

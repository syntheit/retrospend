"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Separator } from "~/components/ui/separator";
import { api } from "~/trpc/react";
import { JobCard, type JobCardData } from "./job-card";

// ── Types ─────────────────────────────────────────────────────────────

interface ImportQueuePanelProps {
	onReviewJob: (jobId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────

export function ImportQueuePanel({ onReviewJob }: ImportQueuePanelProps) {
	const t = useTranslations("dataManagement");
	const utils = api.useUtils();
	const [jobToDelete, setJobToDelete] = useState<string | null>(null);

	// Poll queue status every 2 seconds
	const { data: queueStatus } = api.importQueue.getQueueStatus.useQuery(
		undefined,
		{
			refetchInterval: 2000,
		},
	);

	// Get recent completed/failed jobs
	const { data: recentJobs } = api.importQueue.listJobs.useQuery(
		{
			limit: 10,
			includeCompleted: true,
		},
		{
			refetchInterval: 5000, // Refresh less frequently for completed jobs
		},
	);

	// Mutations
	const cancelJobMutation = api.importQueue.cancelJob.useMutation({
		onSuccess: () => {
			void utils.importQueue.getQueueStatus.invalidate();
			void utils.importQueue.listJobs.invalidate();
			toast.success(t("jobCancelled"));
		},
		onError: (error) => {
			toast.error(t("failedToCancelJob", { message: error.message }));
		},
	});

	const deleteJobMutation = api.importQueue.deleteJob.useMutation({
		onSuccess: () => {
			void utils.importQueue.getQueueStatus.invalidate();
			void utils.importQueue.listJobs.invalidate();
			toast.success(t("jobDeleted"));
			setJobToDelete(null);
		},
		onError: (error) => {
			toast.error(t("failedToDeleteJob", { message: error.message }));
			setJobToDelete(null);
		},
	});

	const handleDeleteClick = (jobId: string) => {
		setJobToDelete(jobId);
	};

	const handleConfirmDelete = () => {
		if (jobToDelete) {
			deleteJobMutation.mutate({ jobId: jobToDelete });
		}
	};

	// Filter recent jobs to show only completed, failed, cancelled
	// Server already filters out terminal jobs older than 24 hours
	const completedJobs =
		recentJobs?.filter((j) =>
			["COMPLETED", "FAILED", "CANCELLED"].includes(j.status),
		) ?? [];

	const failedJobs = completedJobs.filter((j) => j.status === "FAILED");
	const successfulJobs = completedJobs.filter(
		(j) => j.status === "COMPLETED",
	);

	// Show panel only if there are active or recent jobs
	const hasActiveJobs =
		(queueStatus?.processing.length ?? 0) > 0 ||
		(queueStatus?.queued.length ?? 0) > 0 ||
		(queueStatus?.readyForReview.length ?? 0) > 0 ||
		(queueStatus?.reviewing.length ?? 0) > 0;

	const hasRecentJobs = failedJobs.length > 0 || successfulJobs.length > 0;

	if (!hasActiveJobs && !hasRecentJobs) {
		return null;
	}

	return (
		<div className="space-y-4">
			{/* Processing Jobs */}
			{queueStatus?.processing.map((job) => (
				<JobCard
					job={job as JobCardData}
					key={job.id}
					onDelete={() => deleteJobMutation.mutate({ jobId: job.id })}
				/>
			))}

			{/* Queued Jobs */}
			{queueStatus && queueStatus.queued.length > 0 && (
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<h3 className="font-medium tabular-nums text-muted-foreground text-sm">
							{t("queuedCount", { count: queueStatus.queued.length })}
						</h3>
					</div>
					<div className="space-y-2">
						{queueStatus.queued.map((job, idx) => (
							<JobCard
								job={job as JobCardData}
								key={job.id}
								onCancel={() => cancelJobMutation.mutate({ jobId: job.id })}
								position={idx + 1}
							/>
						))}
					</div>
				</div>
			)}

			{/* Ready for Review */}
			{queueStatus?.readyForReview.map((job) => (
				<JobCard
					compact
					job={job as JobCardData}
					key={job.id}
					onDelete={() => handleDeleteClick(job.id)}
					onReview={() => onReviewJob(job.id)}
				/>
			))}

			{/* Currently Reviewing */}
			{queueStatus?.reviewing.map((job) => (
				<JobCard
					compact
					job={job as JobCardData}
					key={job.id}
					onDelete={() => handleDeleteClick(job.id)}
					onReview={() => onReviewJob(job.id)}
				/>
			))}

			{/* Failed Jobs */}
			{failedJobs.length > 0 && (
				<>
					<Separator />
					<div className="space-y-3">
						<h3 className="font-medium text-destructive text-sm">
							{t("failedImports")}
						</h3>
						<div className="space-y-2">
							{failedJobs.slice(0, 3).map((job) => (
								<JobCard
									compact
									job={job as JobCardData}
									key={job.id}
									onDelete={() => handleDeleteClick(job.id)}
								/>
							))}
						</div>
					</div>
				</>
			)}

			{/* Recently Completed */}
			{successfulJobs.length > 0 && (
				<>
					<Separator />
					<div className="space-y-3">
						<h3 className="font-medium tabular-nums text-muted-foreground text-sm">
							{t("recentlyCompleted")}
						</h3>
						<div className="space-y-2">
							{successfulJobs.slice(0, 3).map((job) => (
								<JobCard
									compact
									job={job as JobCardData}
									key={job.id}
									onDelete={() => handleDeleteClick(job.id)}
								/>
							))}
						</div>
					</div>
				</>
			)}

			{/* Delete Confirmation Dialog */}
			<AlertDialog
				onOpenChange={(open) => !open && setJobToDelete(null)}
				open={!!jobToDelete}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("deleteImportJobTitle")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("deleteImportJobDescription")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={handleConfirmDelete}
						>
							{t("delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

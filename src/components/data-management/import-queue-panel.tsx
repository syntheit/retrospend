"use client";

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
			toast.success("Job cancelled");
		},
		onError: (error) => {
			toast.error(`Failed to cancel job: ${error.message}`);
		},
	});

	const deleteJobMutation = api.importQueue.deleteJob.useMutation({
		onSuccess: () => {
			void utils.importQueue.getQueueStatus.invalidate();
			void utils.importQueue.listJobs.invalidate();
			toast.success("Job deleted");
			setJobToDelete(null);
		},
		onError: (error) => {
			toast.error(`Failed to delete job: ${error.message}`);
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
	// Auto-expire successfully completed jobs after 4 hours (failed jobs persist)
	const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
	const completedJobs =
		recentJobs?.filter((j) =>
			["COMPLETED", "FAILED", "CANCELLED"].includes(j.status),
		) ?? [];

	const failedJobs = completedJobs.filter((j) => j.status === "FAILED");
	const successfulJobs = completedJobs.filter(
		(j) =>
			j.status === "COMPLETED" &&
			new Date(j.completedAt ?? j.createdAt) > fourHoursAgo,
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
						<h3 className="font-medium text-muted-foreground text-sm">
							Queued ({queueStatus.queued.length})
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
							Failed Imports
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
						<h3 className="font-medium text-muted-foreground text-sm">
							Recently Completed
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
						<AlertDialogTitle>Delete Import Job</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this import job? This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={handleConfirmDelete}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

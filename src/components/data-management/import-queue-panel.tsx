"use client";

import { useState } from "react";
import { toast } from "sonner";
import { JobCard, type JobCardData } from "./job-card";
import { api } from "~/trpc/react";
import { Separator } from "~/components/ui/separator";
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
	const completedJobs =
		recentJobs?.filter((j) =>
			["COMPLETED", "FAILED", "CANCELLED"].includes(j.status),
		) ?? [];

	const failedJobs = completedJobs.filter((j) => j.status === "FAILED");
	const successfulJobs = completedJobs.filter((j) => j.status === "COMPLETED");

	// Show panel only if there are active or recent jobs
	const hasActiveJobs =
		(queueStatus?.processing.length ?? 0) > 0 ||
		(queueStatus?.queued.length ?? 0) > 0 ||
		(queueStatus?.readyForReview.length ?? 0) > 0 ||
		(queueStatus?.reviewing.length ?? 0) > 0;

	const hasRecentJobs = completedJobs.length > 0;

	if (!hasActiveJobs && !hasRecentJobs) {
		return null;
	}

	return (
		<div className="space-y-4">
			{/* Processing Jobs */}
			{queueStatus?.processing.map((job) => (
				<JobCard
					key={job.id}
					job={job as JobCardData}
					onDelete={() => deleteJobMutation.mutate({ jobId: job.id })}
				/>
			))}

			{/* Queued Jobs */}
			{queueStatus && queueStatus.queued.length > 0 && (
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-medium text-muted-foreground">
							Queued ({queueStatus.queued.length})
						</h3>
					</div>
					<div className="space-y-2">
						{queueStatus.queued.map((job, idx) => (
							<JobCard
								key={job.id}
								job={job as JobCardData}
								position={idx + 1}
								onCancel={() =>
									cancelJobMutation.mutate({ jobId: job.id })
								}
							/>
						))}
					</div>
				</div>
			)}

			{/* Ready for Review */}
			{queueStatus?.readyForReview.map((job) => (
				<JobCard
					key={job.id}
					job={job as JobCardData}
					onReview={() => onReviewJob(job.id)}
					onDelete={() => handleDeleteClick(job.id)}
					compact
				/>
			))}

			{/* Currently Reviewing */}
			{queueStatus?.reviewing.map((job) => (
				<JobCard
					key={job.id}
					job={job as JobCardData}
					onReview={() => onReviewJob(job.id)}
					onDelete={() => handleDeleteClick(job.id)}
					compact
				/>
			))}

			{/* Failed Jobs */}
			{failedJobs.length > 0 && (
				<>
					<Separator />
					<div className="space-y-3">
						<h3 className="text-sm font-medium text-destructive">
							Failed Imports
						</h3>
						<div className="space-y-2">
							{failedJobs.slice(0, 3).map((job) => (
								<JobCard
									key={job.id}
									job={job as JobCardData}
									onDelete={() => handleDeleteClick(job.id)}
									compact
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
						<h3 className="text-sm font-medium text-muted-foreground">
							Recently Completed
						</h3>
						<div className="space-y-2">
							{successfulJobs.slice(0, 5).map((job) => (
								<JobCard
									key={job.id}
									job={job as JobCardData}
									onDelete={() => handleDeleteClick(job.id)}
									compact
								/>
							))}
						</div>
					</div>
				</>
			)}

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={!!jobToDelete} onOpenChange={(open) => !open && setJobToDelete(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Import Job</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this import job? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

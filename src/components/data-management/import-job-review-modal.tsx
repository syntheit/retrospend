"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";
import {
	ImporterReviewManager,
	type ImporterTransaction,
} from "./importer-review-manager";

// ── Types ─────────────────────────────────────────────────────────────

interface ImportJobReviewModalProps {
	jobId: string | null;
	onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────

export function ImportJobReviewModal({
	jobId,
	onClose,
}: ImportJobReviewModalProps) {
	const utils = api.useUtils();

	// Fetch job data
	const { data: job, isLoading } = api.importQueue.getJob.useQuery(
		{ jobId: jobId! },
		{
			enabled: !!jobId,
		},
	);

	// Mark as reviewing when modal opens
	const startReviewMutation = api.importQueue.startReview.useMutation();

	useEffect(() => {
		if (jobId && job?.status === "READY_FOR_REVIEW") {
			startReviewMutation.mutate({ jobId });
		}
	}, [jobId, job?.status, startReviewMutation.mutate]); // eslint-disable-line react-hooks/exhaustive-deps

	// Finalize import mutation
	const finalizeImportMutation = api.importQueue.finalizeImport.useMutation({
		onSuccess: (result) => {
			void utils.importQueue.getQueueStatus.invalidate();
			void utils.importQueue.listJobs.invalidate();
			void utils.expense.listFinalized.invalidate();

			const message =
				result.skippedDuplicates > 0
					? `Imported ${result.count} expense${result.count !== 1 ? "s" : ""} (${result.skippedDuplicates} duplicate${result.skippedDuplicates !== 1 ? "s" : ""} skipped)`
					: `Successfully imported ${result.count} expense${result.count !== 1 ? "s" : ""}`;

			toast.success(message);
			onClose();
		},
		onError: (error) => {
			toast.error(`Failed to import: ${error.message}`);
		},
	});

	// Handle import confirmation
	const handleImportConfirm = async (
		selectedTransactions: ImporterTransaction[],
	) => {
		if (!jobId) return;

		await finalizeImportMutation.mutateAsync({
			jobId,
			selectedTransactions,
		});
	};

	if (!jobId) return null;

	return (
		<Dialog onOpenChange={onClose} open={!!jobId}>
			<DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[1400px] flex-col overflow-hidden pt-12 sm:max-w-[1400px]">
				<DialogTitle className="sr-only">Import Job Review</DialogTitle>
				<DialogDescription className="sr-only">
					Review and apply changes to your imported transactions.
				</DialogDescription>
				{isLoading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
					</div>
				) : job?.transactions ? (
					<ImporterReviewManager
						importerData={job.transactions as unknown as ImporterTransaction[]}
						onCancel={onClose}
						onDone={onClose}
						onImportConfirm={handleImportConfirm}
						warnings={
							job.warnings ? (job.warnings as unknown as string[]) : undefined
						}
					/>
				) : (
					<div className="py-12 text-center text-muted-foreground">
						<p>No transaction data found for this job.</p>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

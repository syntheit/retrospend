import { formatDistanceToNow } from "date-fns";
import {
	CheckCircle2,
	Clock,
	Eye,
	FileText,
	Loader2,
	Trash2,
	XCircle,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";

// ── Types ─────────────────────────────────────────────────────────────

export interface JobCardData {
	id: string;
	status:
		| "QUEUED"
		| "PROCESSING"
		| "READY_FOR_REVIEW"
		| "REVIEWING"
		| "COMPLETED"
		| "FAILED"
		| "CANCELLED";
	type: "CSV" | "BANK_STATEMENT";
	fileName: string;
	fileSize: number;
	totalTransactions: number;
	importedCount: number | null;
	skippedDuplicates: number | null;
	errorMessage: string | null;
	progressPercent: number | null;
	statusMessage: string | null;
	createdAt: Date;
	processingAt: Date | null;
	readyForReviewAt: Date | null;
	completedAt: Date | null;
	failedAt: Date | null;
}

interface JobCardProps {
	job: JobCardData;
	position?: number; // Position in queue (1, 2, 3, etc.)
	onReview?: () => void;
	onDelete?: () => void;
	onCancel?: () => void;
	compact?: boolean;
}

// ── Status Icons ──────────────────────────────────────────────────────

function getStatusIcon(status: JobCardData["status"]) {
	switch (status) {
		case "QUEUED":
			return <Clock className="h-4 w-4 text-muted-foreground" />;
		case "PROCESSING":
			return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
		case "READY_FOR_REVIEW":
		case "REVIEWING":
			return null; // No icon for review status
		case "COMPLETED":
			return <CheckCircle2 className="h-4 w-4 text-green-500" />;
		case "FAILED":
			return <XCircle className="h-4 w-4 text-destructive" />;
		case "CANCELLED":
			return <XCircle className="h-4 w-4 text-muted-foreground" />;
	}
}

function getStatusLabel(status: JobCardData["status"]): string {
	switch (status) {
		case "QUEUED":
			return "Queued";
		case "PROCESSING":
			return "Processing";
		case "READY_FOR_REVIEW":
			return "Ready for Review";
		case "REVIEWING":
			return "Reviewing";
		case "COMPLETED":
			return "Completed";
		case "FAILED":
			return "Failed";
		case "CANCELLED":
			return "Cancelled";
	}
}

function getStatusColor(
	status: JobCardData["status"],
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "QUEUED":
			return "outline";
		case "PROCESSING":
			return "default";
		case "READY_FOR_REVIEW":
		case "REVIEWING":
			return "secondary";
		case "COMPLETED":
			return "outline";
		case "FAILED":
			return "destructive";
		case "CANCELLED":
			return "outline";
	}
}

// ── Component ─────────────────────────────────────────────────────────

export function JobCard({
	job,
	position,
	onReview,
	onDelete,
	onCancel,
	compact = false,
}: JobCardProps) {
	const timestamp =
		job.completedAt ??
		job.failedAt ??
		job.readyForReviewAt ??
		job.processingAt ??
		job.createdAt;

	const timeAgo = formatDistanceToNow(new Date(timestamp), {
		addSuffix: true,
	});

	return (
		<Card>
			<CardContent className={compact ? "px-4 py-2" : "p-4"}>
				<div className="flex items-start justify-between gap-3">
					{/* Left: Icon + Content */}
					<div className="flex min-w-0 flex-1 items-start gap-3">
						{/* Icon */}
						{getStatusIcon(job.status) && (
							<div className="mt-0.5 flex-shrink-0">
								{getStatusIcon(job.status)}
							</div>
						)}

						{/* Content */}
						<div className="min-w-0 flex-1 space-y-1">
							{/* File name */}
							<div className="flex items-center gap-2">
								<FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
								<p className="truncate font-medium text-sm">{job.fileName}</p>
							</div>

							{/* Metadata row */}
							<div className="flex flex-wrap items-center gap-2">
								<Badge className="text-xs" variant={getStatusColor(job.status)}>
									{getStatusLabel(job.status)}
								</Badge>

								{position !== undefined && (
									<Badge className="text-xs" variant="outline">
										#{position}
									</Badge>
								)}

								<span className="text-muted-foreground text-xs">{timeAgo}</span>

								{job.totalTransactions > 0 && (
									<span className="text-muted-foreground text-xs">
										{job.totalTransactions} transaction
										{job.totalTransactions !== 1 ? "s" : ""}
									</span>
								)}
							</div>

							{/* Progress bar (only for PROCESSING) */}
							{job.status === "PROCESSING" && job.progressPercent !== null && (
								<div className="space-y-1">
									<Progress
										className="h-1.5"
										value={job.progressPercent * 100}
									/>
									{job.statusMessage && (
										<p className="text-muted-foreground text-xs">
											{job.statusMessage}
										</p>
									)}
								</div>
							)}

							{/* Error message */}
							{job.status === "FAILED" && job.errorMessage && (
								<p className="text-destructive text-xs">{job.errorMessage}</p>
							)}

							{/* Completed stats */}
							{job.status === "COMPLETED" && job.importedCount !== null && (
								<p className="text-muted-foreground text-xs">
									Imported {job.importedCount} expense
									{job.importedCount !== 1 ? "s" : ""}
									{job.skippedDuplicates !== null &&
										job.skippedDuplicates > 0 &&
										` (${job.skippedDuplicates} duplicate${job.skippedDuplicates !== 1 ? "s" : ""} skipped)`}
								</p>
							)}
						</div>
					</div>

					{/* Right: Actions */}
					<div className="flex flex-shrink-0 items-center gap-2">
						{(job.status === "READY_FOR_REVIEW" ||
							job.status === "REVIEWING") &&
							onReview && (
								<Button onClick={onReview} size="sm">
									Review
								</Button>
							)}

						{(job.status === "READY_FOR_REVIEW" ||
							job.status === "REVIEWING") &&
							onDelete && (
								<Button
									className="h-8 w-8 p-0"
									onClick={onDelete}
									size="sm"
									variant="ghost"
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							)}

						{job.status === "QUEUED" && onCancel && (
							<Button
								className="h-8 w-8 p-0"
								onClick={onCancel}
								size="sm"
								variant="ghost"
							>
								<XCircle className="h-4 w-4" />
							</Button>
						)}

						{(job.status === "COMPLETED" ||
							job.status === "FAILED" ||
							job.status === "CANCELLED") &&
							onDelete && (
								<Button
									className="h-8 w-8 p-0"
									onClick={onDelete}
									size="sm"
									variant="ghost"
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

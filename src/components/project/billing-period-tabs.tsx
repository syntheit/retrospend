"use client";

import { AlertCircle, Check, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const PERIOD_STATUS_STYLES: Record<string, string> = {
	OPEN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	CLOSING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	SETTLED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	ARCHIVED: "bg-muted/50 text-muted-foreground",
};

interface BillingPeriod {
	id: string;
	label: string;
	status: string;
	startDate: Date;
	endDate: Date;
	transactionCount: number;
	unverifiedCount: number;
	totalParticipantCount: number;
}

interface BillingPeriodTabsProps {
	projectId: string;
	periods: BillingPeriod[];
	selectedPeriodId: string | null;
	onSelectPeriod: (periodId: string) => void;
	canClosePeriod: boolean;
	isLoading: boolean;
	isSolo?: boolean;
	onFilterPending?: () => void;
}

export function BillingPeriodTabs({
	projectId,
	periods,
	selectedPeriodId,
	onSelectPeriod,
	canClosePeriod,
	isLoading,
	isSolo,
	onFilterPending,
}: BillingPeriodTabsProps) {
	const utils = api.useUtils();
	const [renamePeriod, setRenamePeriod] = useState<BillingPeriod | null>(null);
	const [newLabel, setNewLabel] = useState("");

	const updateLabelMutation = api.billingPeriod.updateLabel.useMutation({
		onSuccess: () => {
			toast.success("Billing period renamed");
			void utils.billingPeriod.list.invalidate({ projectId });
			void utils.project.detail.invalidate({ id: projectId });
			setRenamePeriod(null);
		},
		onError: (e) => toast.error(e.message),
	});

	const handleRenameSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!renamePeriod || !newLabel.trim()) return;
		updateLabelMutation.mutate({
			projectId,
			periodId: renamePeriod.id,
			label: newLabel.trim(),
		});
	};

	const settleMutation = api.billingPeriod.settlePeriod.useMutation({
		onSuccess: () => {
			toast.success("Period finalized — all transactions are now locked");
			void utils.billingPeriod.list.invalidate({ projectId });
			void utils.project.detail.invalidate({ id: projectId });
		},
		onError: (e) => toast.error(e.message),
	});

	const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

	return (
		<>
			<div className="space-y-3">
				<h3 className="font-semibold text-muted-foreground text-sm tracking-wide">
					Billing Periods
				</h3>

				{/* Period tabs */}
				<ScrollArea className="-mx-4 px-4 lg:-mx-6 lg:px-6">
					<div className="flex gap-2 pb-2">
						{periods.map((period) => {
							const isSelected = period.id === selectedPeriodId;
							return (
								<div
									role="button"
									tabIndex={0}
									className={cn(
										"flex shrink-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
										isSelected
											? "border-primary bg-primary/5"
											: "border-border hover:bg-accent/50",
									)}
									key={period.id}
									onClick={() => onSelectPeriod(period.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onSelectPeriod(period.id);
										}
									}}
								>
									<div className="flex items-center gap-2 group/tab">
										<span className="whitespace-nowrap font-medium">
											{period.label}
										</span>
										{isSelected && canClosePeriod && (
											<Button
												aria-label="Rename billing period"
												type="button"
												className="z-10 h-auto w-auto rounded-sm p-0.5 text-muted-foreground opacity-50 hover:bg-accent hover:text-foreground hover:opacity-100"
												onClick={(e) => {
													e.stopPropagation();
													setRenamePeriod(period);
													setNewLabel(period.label);
												}}
												variant="ghost"
												size="icon"
											>
												<Pencil aria-hidden="true" className="h-3 w-3" />
											</Button>
										)}
										<Badge
											className={`text-[10px] ${PERIOD_STATUS_STYLES[period.status] ?? ""}`}
											variant="outline"
										>
											{period.status.charAt(0) +
												period.status.slice(1).toLowerCase()}
										</Badge>
									</div>
									<span className="text-muted-foreground text-xs">
										{period.transactionCount} expense
										{period.transactionCount !== 1 ? "s" : ""}
									</span>
								</div>
							);
						})}
					</div>
					<ScrollBar orientation="horizontal" />
				</ScrollArea>

				{/* Verification progress for CLOSING periods (group projects only) */}
				{!isSolo && selectedPeriod?.status === "CLOSING" &&
					(() => {
						const verified =
							selectedPeriod.totalParticipantCount -
							selectedPeriod.unverifiedCount;
						const total = selectedPeriod.totalParticipantCount;
						const pct = total > 0 ? (verified / total) * 100 : 0;
						const allVerified = selectedPeriod.unverifiedCount === 0;

						return (
							<div className="flex items-center gap-2">
								<div
									aria-label={allVerified ? "All expenses verified" : `Verification in progress: ${verified} of ${total} verified`}
									role={!allVerified && onFilterPending ? "button" : undefined}
									tabIndex={!allVerified && onFilterPending ? 0 : undefined}
									className={cn(
										"inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
										allVerified
											? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/60 dark:bg-emerald-900/10"
											: "border-amber-200 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-900/10",
										!allVerified && onFilterPending && "cursor-pointer hover:ring-1 hover:ring-amber-400/50 transition-shadow",
									)}
									onClick={!allVerified && onFilterPending ? onFilterPending : undefined}
									onKeyDown={!allVerified && onFilterPending ? (e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onFilterPending();
										}
									} : undefined}
								>
									{allVerified ? (
										<Check aria-hidden="true" className="h-4 w-4 text-emerald-500" />
									) : (
										<AlertCircle aria-hidden="true" className="h-4 w-4 text-amber-500" />
									)}
									<span className="font-medium">
										{allVerified ? "All expenses verified" : "Verification in progress"}
									</span>
									<span className="text-muted-foreground text-xs">{verified}/{total}</span>
									{!allVerified && onFilterPending && (
										<span className="text-muted-foreground text-xs">· click to filter</span>
									)}
								</div>
								{allVerified && canClosePeriod && (
									<Button
										className="h-7 gap-1 text-xs"
										disabled={settleMutation.isPending}
										onClick={() =>
											settleMutation.mutate({
												projectId,
												periodId: selectedPeriod.id,
											})
										}
										size="sm"
									>
										{settleMutation.isPending ? "Finalizing..." : "Finalize Period"}
									</Button>
								)}
							</div>
						);
					})()}

				{/* Settled badge for SETTLED periods */}
				{selectedPeriod?.status === "SETTLED" && (
					<div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/30 px-4 py-3 text-sm dark:border-emerald-800/60 dark:bg-emerald-900/10">
						<Check aria-hidden="true" className="h-4 w-4 text-emerald-500" />
						<span className="text-muted-foreground">
							This period has been finalized. All transactions are locked.
						</span>
					</div>
				)}
			</div>

			{/* Rename Period Dialog */}
			<Dialog open={!!renamePeriod} onOpenChange={(open) => !open && setRenamePeriod(null)}>
				<DialogContent className="sm:max-w-md">
					<form onSubmit={handleRenameSubmit}>
						<DialogHeader>
							<DialogTitle>Rename Period</DialogTitle>
						</DialogHeader>
						<div className="grid gap-4 py-4">
							<div className="grid gap-2">
								<Label htmlFor="period-label">Period Name</Label>
								<Input
									id="period-label"
									value={newLabel}
									onChange={(e) => setNewLabel(e.target.value)}
									placeholder="e.g. March 2026 Trip"
									autoFocus
									maxLength={100}
								/>
							</div>
						</div>
						<DialogFooter className="mt-4">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setRenamePeriod(null)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={updateLabelMutation.isPending || !newLabel.trim() || newLabel.trim() === renamePeriod?.label}
							>
								{updateLabelMutation.isPending ? "Saving..." : "Save Changes"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

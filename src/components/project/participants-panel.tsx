"use client";

import { CheckCircle2, Download, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ShareProjectDialog } from "~/components/project/share-project-dialog";
import { downloadCsv } from "~/lib/utils";
import { api } from "~/trpc/react";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";

const ROLE_COLORS: Record<string, string> = {
	ORGANIZER: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	EDITOR: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
	CONTRIBUTOR: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
	VIEWER: "bg-muted/30 text-muted-foreground",
};

interface Participant {
	id: string;
	participantType: string;
	participantId: string;
	role: string;
	name: string;
	email: string | null;
	avatarUrl: string | null;
	joinedAt: Date;
}

interface ParticipantsPanelProps {
	projectId: string;
	projectName: string;
	createdById: string;
	participants: Participant[];
	isOrganizer: boolean;
	isEditor: boolean;
	currentUserId: string | undefined;
	primaryCurrency: string;
	pendingVerificationCount: number;
}

export function ParticipantsPanel({
	projectId,
	projectName,
	createdById,
	participants,
	isOrganizer,
	isEditor,
	currentUserId,
	primaryCurrency,
	pendingVerificationCount,
}: ParticipantsPanelProps) {
	const [shareOpen, setShareOpen] = useState(false);
	const { formatCurrency } = useCurrencyFormatter();

	const exportMutation = api.exportData.exportSettlementPlan.useMutation();

	const { data: settlementPlan } = api.project.settlementPlan.useQuery(
		{ projectId },
		{ enabled: participants.length > 1 },
	);

	const handleExportSettlements = async () => {
		try {
			const { csv, filename } = await exportMutation.mutateAsync({
				projectId,
				format: "csv",
			});
			downloadCsv(csv, filename);
			toast.success("Settlement plan exported");
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : "Failed to export");
		}
	};

	// ── Settlement helpers ────────────────────────────────────────────────────
	const isCurrentUser = (type: string, id: string) =>
		type === "user" && id === currentUserId;

	const getParticipantName = (type: string, id: string): string => {
		if (isCurrentUser(type, id)) return "you";
		const p = participants.find(
			(x) => x.participantType === type && x.participantId === id,
		);
		return p?.name ?? "Unknown";
	};

	// Flatten all settlement steps across currencies
	const allSteps = settlementPlan
		? Object.entries(settlementPlan.byCurrency).flatMap(
				([, breakdown]) => breakdown.plan,
			)
		: [];

	const allSettled = settlementPlan !== undefined && allSteps.length === 0;

	return (
		<>
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="tabular-nums text-base tracking-tight">
							Participants ({participants.length})
						</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-2">
					{participants.map((p) => (
						<div
							className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
							key={p.id}
						>
							<UserAvatar
								avatarUrl={p.avatarUrl}
								name={p.name}
								size="sm"
							/>
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium text-sm">{p.name}</div>
							</div>
							<Badge
								className={`text-[10px] ${ROLE_COLORS[p.role] ?? ""}`}
								variant="outline"
							>
								{p.role.charAt(0) + p.role.slice(1).toLowerCase()}
							</Badge>
						</div>
					))}
				</CardContent>

				{/* Actions */}
				<div className="space-y-1 border-border border-t px-4 py-2">
					{isEditor && (
						<Button
							className="h-7 w-full gap-1.5 text-muted-foreground text-xs"
							onClick={() => setShareOpen(true)}
							size="sm"
							variant="ghost"
						>
							<UserPlus className="h-3 w-3" />
							Manage access
						</Button>
					)}
					<Button
						className="h-7 w-full gap-1 text-muted-foreground text-xs"
						disabled={exportMutation.isPending}
						onClick={handleExportSettlements}
						size="sm"
						variant="ghost"
					>
						<Download className="h-3 w-3" />
						{exportMutation.isPending ? "Exporting\u2026" : "Export Settlement Plan"}
					</Button>
				</div>

				{/* Settlement summary (multi-person only) */}
				{participants.length > 1 && settlementPlan !== undefined && (
					<div className="border-border border-t px-4 py-3">
						<p className="mb-2 font-medium text-xs text-foreground">
							Settlement
						</p>
						{allSettled ? (
							<div className="flex items-center gap-1.5 text-emerald-600 text-xs dark:text-emerald-400">
								<CheckCircle2 className="h-3.5 w-3.5" />
								All settled up
							</div>
						) : (
							<div className="space-y-1.5">
								{allSteps.map((step, i) => {
									const fromName = getParticipantName(
										step.from.participantType,
										step.from.participantId,
									);
									const toName = getParticipantName(
										step.to.participantType,
										step.to.participantId,
									);
									const youAreFrom = isCurrentUser(
										step.from.participantType,
										step.from.participantId,
									);
									const youAreTo = isCurrentUser(
										step.to.participantType,
										step.to.participantId,
									);
									return (
										<div
											className="flex items-center justify-between gap-2 text-xs"
											// biome-ignore lint/suspicious/noArrayIndexKey: static list
											key={i}
										>
											<span
												className={
													youAreFrom || youAreTo
														? "font-medium text-foreground"
														: "text-muted-foreground"
												}
											>
												{fromName} → {toName}
											</span>
											<span className="shrink-0 font-semibold tabular-nums">
												{formatCurrency(step.amount, step.currency)}
											</span>
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}

				{/* Status summary */}
				<div className="border-border border-t px-4 py-3">
					<p className="mb-2 font-medium text-xs text-foreground">Status</p>
					{pendingVerificationCount > 0 ? (
						<p className="text-amber-600 text-xs dark:text-amber-400">
							{pendingVerificationCount} pending verification
						</p>
					) : (
						<div className="flex items-center gap-1.5 text-emerald-600 text-xs dark:text-emerald-400">
							<CheckCircle2 className="h-3.5 w-3.5" />
							All expenses verified
						</div>
					)}
				</div>
			</Card>

			{/* Share Dialog */}
			<ShareProjectDialog
				createdById={createdById}
				isOrganizer={isOrganizer}
				isEditor={isEditor}
				onOpenChange={setShareOpen}
				open={shareOpen}
				projectId={projectId}
				projectName={projectName}
			/>
		</>
	);
}

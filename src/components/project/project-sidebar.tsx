"use client";

import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/ui/user-avatar";
import { ActivitySidebar } from "~/components/project/activity-sidebar";
import { ShareProjectDialog } from "~/components/project/share-project-dialog";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { api } from "~/trpc/react";

// ── Role badge colors ─────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
	ORGANIZER: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/50",
	EDITOR: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200/50",
	CONTRIBUTOR: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
	VIEWER: "bg-muted/30 text-muted-foreground",
};

// ── ProjectDetailsSidebar ─────────────────────────────────────────────────────

interface ProjectDetailsSidebarProps {
	project: {
		createdAt: Date;
		primaryCurrency: string;
	};
	totalExpenseCount: number;
}

export function ProjectDetailsSidebar({
	project,
	totalExpenseCount,
}: ProjectDetailsSidebarProps) {
	const createdAgo = formatDistanceToNow(project.createdAt, { addSuffix: true });

	return (
		<Card>
			<CardHeader className="px-4 pb-2 pt-4">
				<span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
					Project Details
				</span>
			</CardHeader>
			<CardContent className="px-4 pb-4">
				<dl className="space-y-1.5">
					<div className="flex items-baseline justify-between gap-2">
						<dt className="shrink-0 text-xs text-muted-foreground">Expenses</dt>
						<dd className="truncate text-right text-xs font-medium">
							{totalExpenseCount} expense{totalExpenseCount !== 1 ? "s" : ""}
						</dd>
					</div>
					<div className="flex items-baseline justify-between gap-2">
						<dt className="shrink-0 text-xs text-muted-foreground">Currency</dt>
						<dd className="truncate text-right text-xs font-medium">
							{project.primaryCurrency}
						</dd>
					</div>
					<div className="flex items-baseline justify-between gap-2">
						<dt className="shrink-0 text-xs text-muted-foreground">Created</dt>
						<dd className="truncate text-right text-xs font-medium">
							{createdAgo}
						</dd>
					</div>
				</dl>
			</CardContent>
		</Card>
	);
}

// ── ParticipantsSidebar ───────────────────────────────────────────────────────

const MAX_SHOWN = 5;

interface Participant {
	id: string;
	participantType: string;
	participantId: string;
	role: string;
	name: string;
	avatarUrl: string | null;
}

interface ParticipantsSidebarProps {
	projectId: string;
	projectName: string;
	createdById: string;
	participants: Participant[];
	primaryCurrency: string;
	isOrganizer: boolean;
	isEditor: boolean;
}

export function ParticipantsSidebar({
	projectId,
	projectName,
	createdById,
	participants,
	primaryCurrency,
	isOrganizer,
	isEditor,
}: ParticipantsSidebarProps) {
	const [shareOpen, setShareOpen] = useState(false);
	const { formatCurrency } = useCurrencyFormatter();

	const { data: balancesData, isLoading: balancesLoading } =
		api.project.participantBalances.useQuery(
			{ projectId },
			{ enabled: participants.length > 0 },
		);

	// Map from "type:id" → total paid (summed across currencies)
	const paidByParticipant = useMemo(() => {
		if (!balancesData) return new Map<string, number>();
		const map = new Map<string, number>();
		for (const b of balancesData.balances) {
			const key = `${b.participant.participantType}:${b.participant.participantId}`;
			map.set(key, (map.get(key) ?? 0) + b.totalPaid);
		}
		return map;
	}, [balancesData]);

	const visible = participants.slice(0, MAX_SHOWN);
	const overflowCount = Math.max(0, participants.length - MAX_SHOWN);

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-4">
					<span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
						Participants
					</span>
					<span className="text-[11px] tabular-nums text-muted-foreground">
						{participants.length}
					</span>
				</CardHeader>
				<CardContent className="px-2 pb-2">
					<ul>
						{visible.map((p) => {
							const key = `${p.participantType}:${p.participantId}`;
							const paid = paidByParticipant.get(key) ?? 0;
							return (
								<li className="flex items-center gap-2.5 px-2 py-2" key={p.id}>
									<div className="shrink-0">
										<UserAvatar
											avatarUrl={p.avatarUrl}
											name={p.name}
											size="xs"
										/>
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<span className="truncate text-xs font-medium">
												{p.name}
											</span>
											<Badge
												className={`shrink-0 px-1.5 py-0 text-[10px] leading-4 ${ROLE_COLORS[p.role] ?? ""}`}
												variant="outline"
											>
												{p.role.charAt(0) + p.role.slice(1).toLowerCase()}
											</Badge>
										</div>
										{balancesLoading ? (
											<Skeleton className="mt-0.5 h-3 w-16" />
										) : (
											<p className="mt-0.5 text-[11px] text-muted-foreground">
												{formatCurrency(paid, primaryCurrency)} paid
											</p>
										)}
									</div>
								</li>
							);
						})}
					</ul>
					{overflowCount > 0 && (
						<div className="px-2 pb-1 pt-0.5">
							<Button
								className="h-auto p-0 text-[11px] text-primary hover:underline"
								onClick={() => setShareOpen(true)}
								type="button"
								variant="link"
							>
								+{overflowCount} more
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

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

// ── ProjectSidebar (composed) ─────────────────────────────────────────────────

interface ProjectSidebarProps {
	projectId: string;
	projectName: string;
	createdById: string;
	project: {
		createdAt: Date;
		primaryCurrency: string;
	};
	participants: Participant[];
	totalExpenseCount: number;
	isOrganizer: boolean;
	isEditor: boolean;
	onViewAllActivity: () => void;
}

export function ProjectSidebar({
	projectId,
	projectName,
	createdById,
	project,
	participants,
	totalExpenseCount,
	isOrganizer,
	isEditor,
	onViewAllActivity,
}: ProjectSidebarProps) {
	return (
		<div className="flex flex-col gap-4">
			<ProjectDetailsSidebar
				project={project}
				totalExpenseCount={totalExpenseCount}
			/>
			<ParticipantsSidebar
				createdById={createdById}
				isOrganizer={isOrganizer}
				isEditor={isEditor}
				participants={participants}
				primaryCurrency={project.primaryCurrency}
				projectId={projectId}
				projectName={projectName}
			/>
			<ActivitySidebar
				maxGroups={4}
				onViewAll={onViewAllActivity}
				projectId={projectId}
			/>
		</div>
	);
}

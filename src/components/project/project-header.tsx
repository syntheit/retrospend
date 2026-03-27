"use client";

import { format } from "date-fns";
import {
	Activity,
	BarChart3,
	ChevronDown,
	Download,
	EllipsisVertical,
	FileSpreadsheet,
	FileText,
	Lock,
	Plus,
	Receipt,
	Settings,
	Share2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { ProjectVisual } from "~/components/project/project-visual";
import { ShareProjectDialog } from "~/components/project/share-project-dialog";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { useUserSettings } from "~/hooks/use-user-settings";

export const PROJECT_TYPE_COLORS: Record<string, string> = {
	TRIP: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
	ONGOING: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	SOLO: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	ONE_TIME: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
	GENERAL: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

export const PROJECT_TYPE_LABELS: Record<string, string> = {
	TRIP: "Trip",
	ONGOING: "Ongoing",
	SOLO: "Solo",
	ONE_TIME: "One-Time",
	GENERAL: "General",
};


interface Participant {
	id: string;
	participantType: string;
	participantId: string;
	role: string;
	name: string;
	email: string | null;
	avatarUrl: string | null;
	username?: string | null;
	joinedAt: Date;
}

// ── ParticipantRow ────────────────────────────────────────────────────────────

interface ParticipantRowItem {
	participantType: string;
	participantId: string;
	role: string;
	name: string;
	avatarUrl: string | null;
	username?: string | null;
}

const MAX_VISIBLE_PARTICIPANTS = 5;

export function ParticipantRow({
	participants,
	onMoreClick,
	linkMode,
	currentUserId,
}: {
	participants: ParticipantRowItem[];
	onMoreClick?: () => void;
	/** "people" → /people/[type]/[id] (authenticated, shows balance); "profile" → /u/[username] (public profile) */
	linkMode?: "people" | "profile";
	/** When set, disables navigation for the current user's own entry */
	currentUserId?: string;
}) {
	if (participants.length === 0) return null;

	const visible = participants.slice(0, MAX_VISIBLE_PARTICIPANTS);
	const extra = participants.length - MAX_VISIBLE_PARTICIPANTS;

	return (
		<div className="flex flex-wrap items-center gap-3">
			{visible.map((p) => {
				const isOrganizer = p.role === "ORGANIZER";
				const isSelf =
					currentUserId &&
					p.participantType === "user" &&
					p.participantId === currentUserId;
				const href = isSelf
					? null
					: linkMode === "people"
						? `/people/${p.participantType}/${p.participantId}`
						: linkMode === "profile" && p.participantType === "user" && p.username
							? `/u/${p.username}`
							: null;

				const inner = (
					<>
						<UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="xs" />
						<span
							className={cn(
								"text-sm text-muted-foreground",
								isOrganizer && "font-medium text-foreground",
							)}
						>
							{p.name}
						</span>
						{isOrganizer && (
							<span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
								Organizer
							</span>
						)}
					</>
				);

				if (href) {
					return (
						<Link
							key={`${p.participantType}-${p.participantId}`}
							className="flex items-center gap-1.5 no-underline transition-opacity hover:opacity-80"
							href={href}
						>
							{inner}
						</Link>
					);
				}

				return (
					<div
						key={`${p.participantType}-${p.participantId}`}
						className="flex items-center gap-1.5"
					>
						{inner}
					</div>
				);
			})}

			{extra > 0 &&
				(onMoreClick ? (
					<Button
						className="h-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/80"
						onClick={onMoreClick}
						type="button"
						variant="ghost"
					>
						+{extra} more
					</Button>
				) : (
					<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
						+{extra} more
					</span>
				))}
		</div>
	);
}

interface ProjectHeaderProps {
	project: {
		id: string;
		name: string;
		type: string;
		status: string;
		description: string | null;
		createdById: string;
		imagePath?: string | null;
	};
	isOrganizer: boolean;
	isEditor: boolean;
	isSolo: boolean;
	onSettingsOpen: () => void;
	onAddExpense: () => void;
	onExportExpenses?: () => void;
	onExportSettlement?: () => void;
	onExportPeriodSummary?: () => void;
	onExportPdf?: () => void;
	isExporting?: boolean;
	onClosePeriod?: () => void;
	showClosePeriod?: boolean;
	onActivityOpen?: () => void;
	unseenCount?: number;
	participants?: Participant[];
	showPeriodSummaryExport?: boolean;
	startDate?: Date | null;
	endDate?: Date | null;
	primaryCurrency?: string;
	expenseCount?: number;
	currentUserId?: string;
	excludeFromAnalytics?: boolean;
	onToggleAnalyticsExclusion?: (exclude: boolean) => void;
	isAnalyticsTogglePending?: boolean;
}

export function ProjectHeader({
	project,
	isOrganizer,
	isEditor,
	isSolo,
	onSettingsOpen,
	onAddExpense,
	onExportExpenses,
	onExportSettlement,
	onExportPeriodSummary,
	onExportPdf,
	isExporting,
	onClosePeriod,
	showClosePeriod,
	onActivityOpen,
	unseenCount,
	participants,
	showPeriodSummaryExport,
	startDate,
	endDate,
	primaryCurrency,
	expenseCount,
	currentUserId,
	excludeFromAnalytics,
	onToggleAnalyticsExclusion,
	isAnalyticsTogglePending,
}: ProjectHeaderProps) {
	const [shareOpen, setShareOpen] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const utils = api.useUtils();
	const { settings } = useUserSettings();

	const dateRange = (() => {
		if (!startDate && !endDate) return null;
		const fmt = (d: Date) => format(d, "MMM d");
		if (startDate && endDate) return `${fmt(startDate)}–${fmt(endDate)}`;
		if (startDate) return `From ${fmt(startDate)}`;
		return `Until ${fmt(endDate!)}`;
	})();

	const metaParts: string[] = [];
	if (!isSolo && participants && participants.length > 0) {
		metaParts.push(`${participants.length} participant${participants.length !== 1 ? "s" : ""}`);
	}
	if (dateRange) metaParts.push(dateRange);
	if (primaryCurrency && primaryCurrency !== settings?.defaultCurrency) metaParts.push(primaryCurrency);
	if (expenseCount !== undefined) {
		metaParts.push(`${expenseCount} expense${expenseCount !== 1 ? "s" : ""}`);
	}
	const metaSubtitle = metaParts.length > 0 ? metaParts.join(" · ") : null;

	const canEdit = isOrganizer || isEditor;

	const handleUpload = async (file: File) => {
		const localPreview = URL.createObjectURL(file);
		setPreviewUrl(localPreview);

		const formData = new FormData();
		formData.append("file", file);
		formData.append("projectId", project.id);

		try {
			const res = await fetch("/api/upload/project-image", {
				method: "POST",
				body: formData,
			});

			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				throw new Error(data.error ?? "Upload failed");
			}

			void utils.project.detail.invalidate({ id: project.id });
			void utils.project.list.invalidate();
			toast.success("Project icon updated");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to upload icon",
			);
		} finally {
			URL.revokeObjectURL(localPreview);
			setPreviewUrl(null);
		}
	};

	const hasExportOptions =
		onExportExpenses || onExportSettlement || onExportPeriodSummary || onExportPdf;

	return (
		<>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				{/* Icon + name/description + participants */}
				<div className="flex items-center gap-4">
					{previewUrl ? (
						<div className="h-20 w-20 shrink-0 overflow-hidden rounded-full">
							<img
								alt={`${project.name} icon`}
								className="h-full w-full object-cover"
								src={previewUrl}
							/>
						</div>
					) : (
						<ProjectVisual
							editable={canEdit}
							imagePath={project.imagePath ?? null}
							onUpload={handleUpload}
							projectName={project.name}
							projectType={project.type}
							size="xl"
						/>
					)}
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="font-bold text-2xl">{project.name}</h2>
							<Badge
								className={PROJECT_TYPE_COLORS[project.type] ?? ""}
								variant="outline"
							>
								{PROJECT_TYPE_LABELS[project.type] ?? project.type}
							</Badge>
							{project.status !== "ACTIVE" && (
								<div className="flex items-center">
									<span className="text-muted-foreground text-xs capitalize">
										{project.status.toLowerCase()}
									</span>
								</div>
							)}
						</div>
						{project.description && (
							<p className="max-w-xl text-muted-foreground text-sm">
								{project.description}
							</p>
						)}
						{/* Metadata subtitle */}
						{metaSubtitle && (
							<p className="tabular-nums text-muted-foreground text-xs">{metaSubtitle}</p>
						)}
						{/* Participant row */}
						{!isSolo && participants && participants.length > 0 && (
							<ParticipantRow
								currentUserId={currentUserId}
								linkMode="people"
								onMoreClick={() => setShareOpen(true)}
								participants={participants}
							/>
						)}
					</div>
				</div>

				{/* Action buttons */}
				<div className="flex flex-wrap items-center gap-1.5">
					<Button onClick={onAddExpense} size="sm">
						<Plus className="mr-1 h-4 w-4" />
						Add Expense
					</Button>
					<div className="flex items-center gap-0.5">
						{!isSolo && (
							<Button
								onClick={() => setShareOpen(true)}
								size="sm"
								variant="ghost"
								title="Share"
							>
								<Share2 className="h-4 w-4" />
								Share
							</Button>
						)}
						{!isSolo && onActivityOpen && (
							<Button
								onClick={onActivityOpen}
								size="sm"
								variant="ghost"
								className="relative"
								title="Activity"
							>
								<Activity className="h-4 w-4" />
								Activity
								{!!unseenCount && unseenCount > 0 && (
									<span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
										{unseenCount > 99 ? "99+" : unseenCount}
									</span>
								)}
							</Button>
						)}
						{hasExportOptions && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										disabled={isExporting}
										size="sm"
										variant="ghost"
										title="Export"
										className="focus-visible:ring-0 focus-visible:ring-offset-0"
									>
										<Download className="h-4 w-4" />
										Export
										<ChevronDown className="h-3 w-3 opacity-60" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{onExportExpenses && (
										<DropdownMenuItem onClick={onExportExpenses}>
											<FileSpreadsheet className="mr-2 h-4 w-4" />
											Export Expenses (CSV)
										</DropdownMenuItem>
									)}
									{onExportSettlement && !isSolo && (
										<DropdownMenuItem onClick={onExportSettlement}>
											<Receipt className="mr-2 h-4 w-4" />
											Export Settlement Plan
										</DropdownMenuItem>
									)}
									{showPeriodSummaryExport && onExportPeriodSummary && (
										<DropdownMenuItem onClick={onExportPeriodSummary}>
											<FileSpreadsheet className="mr-2 h-4 w-4" />
											Export Period Summary
										</DropdownMenuItem>
									)}
									{onExportPdf && (
										<DropdownMenuItem onClick={onExportPdf}>
											<FileText className="mr-2 h-4 w-4" />
											Download PDF Summary
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
						{showClosePeriod && onClosePeriod && (
					<Button
						onClick={onClosePeriod}
						size="sm"
						variant="ghost"
						title="Close Period"
					>
						<Lock className="h-4 w-4" />
						Close Period
					</Button>
				)}
				{canEdit && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										onClick={onSettingsOpen}
										size="icon-sm"
										variant="ghost"
										title="Settings"
									>
										<Settings className="h-4 w-4" />
										<span className="sr-only">Settings</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>Settings</TooltipContent>
							</Tooltip>
						)}
						{onToggleAnalyticsExclusion && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon-sm"
										variant="ghost"
										title="More options"
										className="focus-visible:ring-0 focus-visible:ring-offset-0"
									>
										<EllipsisVertical className="h-4 w-4" />
										<span className="sr-only">More options</span>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuCheckboxItem
										className="cursor-pointer"
										checked={!excludeFromAnalytics}
										disabled={isAnalyticsTogglePending}
										onCheckedChange={(checked) =>
											onToggleAnalyticsExclusion(!checked)
										}
									>
										<BarChart3 className="mr-2 h-4 w-4" />
										Include in analytics
									</DropdownMenuCheckboxItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</div>
			</div>

			<ShareProjectDialog
				createdById={project.createdById}
				isOrganizer={isOrganizer}
				isEditor={isEditor}
				onOpenChange={setShareOpen}
				open={shareOpen}
				projectId={project.id}
				projectName={project.name}
			/>
		</>
	);
}

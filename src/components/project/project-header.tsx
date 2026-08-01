"use client";

import {
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

import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useUserSettings } from "~/hooks/use-user-settings";



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

	const sorted = [...participants].sort((a, b) => {
		if (a.role === "ORGANIZER" && b.role !== "ORGANIZER") return -1;
		if (a.role !== "ORGANIZER" && b.role === "ORGANIZER") return 1;
		return 0;
	});
	const visible = sorted.slice(0, MAX_VISIBLE_PARTICIPANTS);
	const extra = participants.length - MAX_VISIBLE_PARTICIPANTS;

	return (
		<div className="flex flex-wrap items-center gap-3">
			{visible.map((p) => {
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
						<span className="text-sm text-muted-foreground">
							{p.name}
						</span>
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
		status: string;
		description: string | null;
		createdById: string;
		imagePath?: string | null;
	};
	isOrganizer: boolean;
	isEditor: boolean;
	onSettingsOpen: () => void;
	onAddExpense?: () => void;
	onExportExpenses?: () => void;
	onExportSettlement?: () => void;
	onExportPeriodSummary?: () => void;
	onExportPdf?: () => void;
	isExporting?: boolean;
	onClosePeriod?: () => void;
	showClosePeriod?: boolean;
	participants?: Participant[];
	showPeriodSummaryExport?: boolean;
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
	onSettingsOpen,
	onAddExpense,
	onExportExpenses,
	onExportSettlement,
	onExportPeriodSummary,
	onExportPdf,
	isExporting,
	onClosePeriod,
	showClosePeriod,
	participants,
	showPeriodSummaryExport,
	primaryCurrency,
	expenseCount,
	currentUserId,
	excludeFromAnalytics,
	onToggleAnalyticsExclusion,
	isAnalyticsTogglePending,
}: ProjectHeaderProps) {
	const t = useTranslations("projects");
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [shareOpen, setShareOpen] = useState(false);
	const utils = api.useUtils();
	const { settings } = useUserSettings();
	const isSolo = !participants || participants.length <= 1;

	const metaParts: string[] = [];
	if (!isSolo && participants && participants.length > 0) {
		metaParts.push(t("participantCount", { count: participants.length }));
	}
	if (primaryCurrency && primaryCurrency !== settings?.homeCurrency) metaParts.push(primaryCurrency);
	if (expenseCount !== undefined) {
		metaParts.push(t("expenseCount", { count: expenseCount }));
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
			toast.success(t("projectIconUpdated"));
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : t("failedToUploadIcon"),
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
							size="xl"
						/>
					)}
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="font-bold text-2xl">{project.name}</h2>
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
					{onAddExpense && (
						<Button onClick={onAddExpense} size="sm">
							<Plus className="mr-1 h-4 w-4" />
							{t("addExpense")}
						</Button>
					)}
					<div className="flex items-center gap-0.5">
						{!isSolo && (
							<Button
								onClick={() => setShareOpen(true)}
								size="sm"
								variant="ghost"
								title={t("share")}
							>
								<Share2 className="h-4 w-4" />
								{t("share")}
							</Button>
						)}
						{hasExportOptions && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										disabled={isExporting}
										size="sm"
										variant="ghost"
										title={t("export")}
										className="focus-visible:ring-0 focus-visible:ring-offset-0"
									>
										<Download className="h-4 w-4" />
										{t("export")}
										<ChevronDown className="h-3 w-3 opacity-60" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{onExportExpenses && (
										<DropdownMenuItem onClick={onExportExpenses}>
											<FileSpreadsheet className="mr-2 h-4 w-4" />
											{t("exportExpensesCsv")}
										</DropdownMenuItem>
									)}
									{onExportSettlement && !isSolo && (
										<DropdownMenuItem onClick={onExportSettlement}>
											<Receipt className="mr-2 h-4 w-4" />
											{t("exportSettlementPlan")}
										</DropdownMenuItem>
									)}
									{showPeriodSummaryExport && onExportPeriodSummary && (
										<DropdownMenuItem onClick={onExportPeriodSummary}>
											<FileSpreadsheet className="mr-2 h-4 w-4" />
											{t("exportPeriodSummary")}
										</DropdownMenuItem>
									)}
									{onExportPdf && (
										<DropdownMenuItem onClick={onExportPdf}>
											<FileText className="mr-2 h-4 w-4" />
											{t("downloadPdfSummary")}
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
						title={t("closePeriod")}
					>
						<Lock className="h-4 w-4" />
						{t("closePeriod")}
					</Button>
				)}
				{canEdit && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										onClick={onSettingsOpen}
										size="icon-sm"
										variant="ghost"
										title={t("settings")}
									>
										<Settings className="h-4 w-4" />
										<span className="sr-only">{t("settings")}</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>{t("settings")}</TooltipContent>
							</Tooltip>
						)}
						{onToggleAnalyticsExclusion && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon-sm"
										variant="ghost"
										title={t("moreOptions")}
										className="focus-visible:ring-0 focus-visible:ring-offset-0"
									>
										<EllipsisVertical className="h-4 w-4" />
										<span className="sr-only">{t("moreOptions")}</span>
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
										{t("includeInAnalytics")}
									</DropdownMenuCheckboxItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</div>
			</div>

			{!isSolo && (
				<ShareProjectDialog
					createdById={project.createdById}
					isEditor={isEditor}
					isOrganizer={isOrganizer}
					onOpenChange={setShareOpen}
					open={shareOpen}
					projectId={project.id}
					projectName={project.name}
				/>
			)}
		</>
	);
}

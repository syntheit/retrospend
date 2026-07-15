"use client";

import {
	Archive,
	Copy,
	FolderOpen,
	Link,
	MoreHorizontal,
	Plus,
	ReceiptText,
	RotateCcw,
	Share2,
	Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ElementType, type MouseEvent as ReactMouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageContent } from "~/components/page-content";
import { NewProjectDialog } from "~/components/project/new-project-dialog";
import { ExpandableSearch } from "~/components/table-search";
import { ProjectVisual } from "~/components/project/project-visual";
import { ShareProjectDialog } from "~/components/project/share-project-dialog";
import { SiteHeader } from "~/components/site-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useSession } from "~/hooks/use-session";
import { getImageUrl } from "~/lib/image-url";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

function LastActivityLabel({ projectId, fallbackDate }: { projectId: string; fallbackDate: Date | string }) {
	const t = useTranslations("projects");
	const { data, isLoading } = api.auditLog.projectLastActivity.useQuery(
		{ projectId },
		{ staleTime: 60_000 },
	);

	if (isLoading || !data) {
		return (
			<span>
				{t("updated")}{" "}
				{new Date(fallbackDate).toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
				})}
			</span>
		);
	}

	// Truncate summary for card display
	const summary = data.summary.length > 45
		? data.summary.slice(0, 42) + "..."
		: data.summary;

	return (
		<span>
			{summary} &middot; {data.relativeTime}
		</span>
	);
}

type StatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

const FILTER_VALUES = ["ACTIVE", "ARCHIVED", "ALL"] as const;

type ProjectItem = RouterOutputs["project"]["list"][number];

interface CardAction {
	id: string;
	label: string;
	icon: ElementType;
	onClick: (e: ReactMouseEvent) => void;
	disabled?: boolean;
	primary?: boolean;
	destructive?: boolean;
}

/**
 * Measures which action buttons fit in the container and returns visible/overflow splits.
 * Uses ResizeObserver to update as the card resizes.
 */
function useOverflowActions(
	candidates: CardAction[],
	containerRef: RefObject<HTMLDivElement | null>,
	buttonRefs: RefObject<(HTMLButtonElement | null)[]>,
): { visibleCount: number } {
	const [visibleCount, setVisibleCount] = useState(candidates.length);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		function measure() {
			const containerWidth = containerRef.current?.clientWidth ?? 0;
			const GAP = 2; // gap-0.5 = 2px
			let used = 0;
			let count = 0;
			for (const btn of buttonRefs.current) {
				if (!btn) continue;
				const w = btn.offsetWidth + (count > 0 ? GAP : 0);
				if (used + w <= containerWidth) {
					used += w;
					count++;
				} else {
					break;
				}
			}
			setVisibleCount(count);
		}

		const ro = new ResizeObserver(measure);
		ro.observe(container);
		// Measure after first paint so button widths are accurate
		const raf = requestAnimationFrame(measure);
		return () => {
			ro.disconnect();
			cancelAnimationFrame(raf);
		};
	}, [candidates.length, containerRef, buttonRefs]);

	return { visibleCount };
}

function ProjectCardFooter({
	candidateActions,
	menuActions,
}: {
	candidateActions: CardAction[];
	menuActions: CardAction[];
}) {
	const t = useTranslations("projects");
	const containerRef = useRef<HTMLDivElement>(null);
	const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const { visibleCount } = useOverflowActions(candidateActions, containerRef, buttonRefs);

	// Only show overflow menu when candidate buttons don't all fit
	const hasOverflow = visibleCount < candidateActions.length;
	const visibleIds = new Set(candidateActions.slice(0, visibleCount).map((a) => a.id));
	const overflowMenuActions = menuActions.filter((a) => !visibleIds.has(a.id));

	return (
		<div
			className="relative z-10 flex items-center justify-between border-t border-white/10 bg-black/60 px-2 py-2 backdrop-blur-sm"
			onClick={(e) => e.stopPropagation()}
		>
			{/* Visible action buttons */}
			<div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
				{candidateActions.map((action, i) => {
					const Icon = action.icon;
					const isVisible = i < visibleCount;
					return (
						<button
							key={action.id}
							ref={(el) => {
								buttonRefs.current[i] = el;
							}}
							className={cn(
								"inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
								"hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
								"disabled:pointer-events-none disabled:opacity-50",
								action.primary
									? "text-white"
									: "text-white/60 hover:text-white/90",
								!isVisible && "hidden",
							)}
							disabled={action.disabled}
							onClick={action.onClick}
							title={action.label}
							type="button"
						>
							<Icon className="h-4 w-4 shrink-0" />
							<span>{action.label}</span>
						</button>
					);
				})}
			</div>

			{/* Three-dot menu - only shown when buttons overflow */}
			{hasOverflow && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							className="ml-1 flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
							onClick={(e) => e.stopPropagation()}
							title={t("moreActions")}
							type="button"
						>
							<MoreHorizontal className="h-4 w-4" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
						{overflowMenuActions
							.filter((a) => !a.destructive)
							.map((action) => {
								const Icon = action.icon;
								return (
									<DropdownMenuItem
										key={action.id}
										disabled={action.disabled}
										onClick={action.onClick}
									>
										<Icon className="h-4 w-4" />
										{action.label}
									</DropdownMenuItem>
								);
							})}
						{overflowMenuActions.some((a) => a.destructive) && (
							<>
								<DropdownMenuSeparator />
								{overflowMenuActions
									.filter((a) => a.destructive)
									.map((action) => {
										const Icon = action.icon;
										return (
											<DropdownMenuItem
												key={action.id}
												disabled={action.disabled}
												onClick={action.onClick}
												variant="destructive"
											>
												<Icon className="h-4 w-4" />
												{action.label}
											</DropdownMenuItem>
										);
									})}
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}

function ProjectCard({
	project,
	filter,
	formatCurrency,
}: {
	project: ProjectItem;
	filter: StatusFilter;
	formatCurrency: (amount: number, currency: string) => string;
}) {
	const t = useTranslations("projects");
	const router = useRouter();
	const utils = api.useUtils();
	const { data: session } = useSession();
	const { openNewExpense } = useExpenseModal();
	const pressStartedHere = useRef(false);

	const [shareOpen, setShareOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	const isOrganizer = project.myRole === "ORGANIZER";
	const isEditor = project.myRole === "EDITOR" || isOrganizer;
	const isCreator = session?.user?.id === project.createdById;
	const isViewer = project.myRole === "VIEWER";

	const statusMutation = api.project.update.useMutation({
		onSuccess: (_data, variables) => {
			toast.success(variables.status === "ARCHIVED" ? t("projectArchived") : t("projectRestored"));
			void utils.project.list.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const deleteMutation = api.project.delete.useMutation({
		onSuccess: () => {
			toast.success(t("projectDeleted"));
			void utils.project.list.invalidate();
			setDeleteOpen(false);
		},
		onError: (e) => toast.error(e.message),
	});

	const handleCopyLink = async () => {
		const url = `${window.location.origin}/projects/${project.id}`;
		await navigator.clipboard.writeText(url);
		toast.success(t("linkCopied"));
	};

	const budgetAmount = project.budgetAmount
		? Number(project.budgetAmount)
		: null;
	const budgetCurrency = project.budgetCurrency ?? project.primaryCurrency;
	const utilization =
		budgetAmount && budgetAmount > 0
			? (project.totalSpent / budgetAmount) * 100
			: null;
	const imageUrl = getImageUrl(project.imagePath ?? null);
	const bgGradient = "from-indigo-600 to-purple-700";

	// --- Action definitions ---

	// Candidate visible actions (priority order: Add Expense → Share → Copy Link → Settle)
	const candidateActions: CardAction[] = [
		...(project.status !== "ARCHIVED" && !isViewer
			? [
					{
						id: "add-expense",
						label: t("addExpense"),
						icon: ReceiptText,
						primary: true,
						onClick: (e: ReactMouseEvent) => {
							e.stopPropagation();
							openNewExpense({
								projectId: project.id,
								projectName: project.name,
								projectDefaultCurrency: project.primaryCurrency,
							});
						},
					},
				]
			: []),
		{
			id: "share",
			label: t("share"),
			icon: Share2,
			onClick: (e: ReactMouseEvent) => {
				e.stopPropagation();
				setShareOpen(true);
			},
		},
		{
			id: "copy-link",
			label: t("copyLink"),
			icon: Link,
			onClick: (e: ReactMouseEvent) => {
				e.stopPropagation();
				void handleCopyLink();
			},
		},
	];

	// All menu actions (candidates + archive/restore/reactivate/delete)
	const menuActions: CardAction[] = [
		...candidateActions,
		...(isOrganizer && project.status === "ACTIVE"
			? [
					{
						id: "archive",
						label: t("archive"),
						icon: Archive,
						disabled: statusMutation.isPending,
						onClick: (e: ReactMouseEvent) => {
							e.stopPropagation();
							statusMutation.mutate({ id: project.id, status: "ARCHIVED" });
						},
					},
				]
			: []),
		...(isOrganizer && project.status === "ARCHIVED"
			? [
					{
						id: "restore",
						label: t("restore"),
						icon: RotateCcw,
						disabled: statusMutation.isPending,
						onClick: (e: ReactMouseEvent) => {
							e.stopPropagation();
							statusMutation.mutate({ id: project.id, status: "ACTIVE" });
						},
					},
				]
			: []),
		...(isCreator
			? [
					{
						id: "delete",
						label: t("delete"),
						icon: Trash2,
						destructive: true,
						onClick: (e: ReactMouseEvent) => {
							e.stopPropagation();
							setDeleteOpen(true);
						},
					},
				]
			: []),
	];

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<Card
						className="group relative cursor-pointer overflow-hidden gap-0 p-0 transition-all duration-200 ease-out hover:-translate-y-1 hover:brightness-[1.15] hover:shadow-xl active:translate-y-0 active:scale-[0.98] active:brightness-100 active:shadow-none"
						onPointerDown={() => { pressStartedHere.current = true; }}
						onClick={(e) => {
							if (!pressStartedHere.current) return;
							pressStartedHere.current = false;
							const rect = e.currentTarget.getBoundingClientRect();
							if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
							if (e.ctrlKey || e.metaKey) {
								window.open(`/projects/${project.id}`, "_blank");
							} else {
								router.push(`/projects/${project.id}`);
							}
						}}
					>
						{/* Background: blurred image or type gradient */}
						{imageUrl ? (
							<div
								className="absolute inset-0 scale-110 bg-cover bg-center blur-xl"
								style={{ backgroundImage: `url(${imageUrl})` }}
							/>
						) : (
							<div
								className={cn(
									"absolute inset-0 bg-gradient-to-br",
									bgGradient,
								)}
							/>
						)}

						{/* Dark scrim */}
						<div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />

						{/* Card body */}
						<div className="relative flex items-start gap-3 p-4">
							<div className="min-w-0 flex-1 space-y-1.5">
								<div className="flex flex-wrap items-center gap-1">
									{project.isSettled && (
										<Badge className="border-emerald-400/30 bg-emerald-500/20 text-[10px] text-emerald-300 backdrop-blur-sm">
											{t("settledBadge")}
										</Badge>
									)}
									{filter === "ALL" && project.status !== "ACTIVE" && (
										<Badge className="border-white/20 bg-white/15 text-[10px] text-white backdrop-blur-sm">
											{project.status === "ARCHIVED" ? t("archived") : project.status}
										</Badge>
									)}
								</div>
								<h3 className="font-bold text-base text-white leading-tight">
									{project.name}
								</h3>

								{/* Participants */}
								<div className="flex items-center gap-2">
									<div className="flex -space-x-3 transition-all duration-300 ease-out group-hover:space-x-1">
										{project.participants.slice(0, 5).map((p) => (
											<UserAvatar
												avatarUrl={p.avatarUrl}
												className="border-2 border-black/40 transition-all duration-300 ease-out"
												key={p.id}
												name={p.name}
												size="md"
											/>
										))}
									</div>
									{project._count.participants > 5 && (
										<span className="text-white/60 text-xs">
											+{project._count.participants - 5}
										</span>
									)}
									<span className="text-white/60 text-xs">
										{project._count.participants} {project._count.participants !== 1 ? t("participantsPlural") : t("participants")}
									</span>
									{project.currentBillingPeriod != null && (
										<>
											<span className="text-white/40 text-xs">·</span>
											<span className="text-white/60 text-xs">
												{project.currentBillingPeriod.label} · <span className="capitalize">{project.currentBillingPeriod.status.toLowerCase()}</span>
											</span>
										</>
									)}
								</div>

								{/* Budget progress */}
								{budgetAmount !== null && (
									<div>
										<div className="mb-1 flex justify-between text-xs text-white/70">
											<span className="tabular-nums">
												{formatCurrency(
													project.totalSpent,
													budgetCurrency,
												)}{" "}
												/{" "}
												{formatCurrency(
													budgetAmount,
													budgetCurrency,
												)}
											</span>
											{utilization !== null && (
												<span
													className={cn(
														"tabular-nums",
														utilization > 100
															? "text-rose-400"
															: utilization > 80
																? "text-amber-400"
																: "text-white/70",
													)}
												>
													{Math.round(utilization)}%
												</span>
											)}
										</div>
										<div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
											<div
												className={cn(
													"h-full rounded-full transition-all",
													utilization !== null && utilization > 100
														? "bg-rose-400"
														: utilization !== null &&
																utilization > 80
															? "bg-amber-400"
															: "bg-emerald-400",
												)}
												style={{
													width: `${Math.min(utilization ?? 0, 100)}%`,
												}}
											/>
										</div>
									</div>
								)}

								{/* Last activity */}
								<div className="text-white/40 text-xs">
									<LastActivityLabel
										fallbackDate={project.updatedAt}
										projectId={project.id}
									/>
								</div>
							</div>
							<ProjectVisual
								className="shrink-0 ring-2 ring-white/20 shadow-lg !h-[84px] !w-[84px] !rounded-[12px]"
								imagePath={project.imagePath ?? null}
								projectName={project.name}
								size="lg"
							/>
						</div>

						{/* Action footer */}
						<ProjectCardFooter
							candidateActions={candidateActions}
							menuActions={menuActions}
						/>
					</Card>
				</ContextMenuTrigger>

				<ContextMenuContent>
					{!isViewer && project.status !== "ARCHIVED" && (
						<ContextMenuItem
							onClick={() =>
								openNewExpense({
									projectId: project.id,
									projectName: project.name,
									projectDefaultCurrency: project.primaryCurrency,
								})
							}
						>
							<ReceiptText />
							{t("addExpense")}
						</ContextMenuItem>
					)}

					<ContextMenuItem onClick={() => setShareOpen(true)}>
						<Share2 />
						{t("share")}
					</ContextMenuItem>

					<ContextMenuItem onClick={handleCopyLink}>
						<Copy />
						{t("copyLink")}
					</ContextMenuItem>

					{isOrganizer && (
						<>
							<ContextMenuSeparator />

							{project.status === "ACTIVE" && (
								<ContextMenuItem
									disabled={statusMutation.isPending}
									onClick={() =>
										statusMutation.mutate({
											id: project.id,
											status: "ARCHIVED",
										})
									}
								>
									<Archive />
									{t("archive")}
								</ContextMenuItem>
							)}

							{project.status === "ARCHIVED" && (
								<ContextMenuItem
									disabled={statusMutation.isPending}
									onClick={() =>
										statusMutation.mutate({
											id: project.id,
											status: "ACTIVE",
										})
									}
								>
									<RotateCcw />
									{t("restore")}
								</ContextMenuItem>
							)}
						</>
					)}

					{isCreator && (
						<>
							<ContextMenuSeparator />
							<ContextMenuItem
								onClick={() => setDeleteOpen(true)}
								variant="destructive"
							>
								<Trash2 />
								{t("delete")}
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>

			<ShareProjectDialog
				createdById={project.createdById}
				isOrganizer={isOrganizer}
				isEditor={isEditor}
				onOpenChange={setShareOpen}
				open={shareOpen}
				projectId={project.id}
				projectName={project.name}
			/>

			<ConfirmationDialog
				confirmLabel={t("delete")}
				description={t("deleteDescription", { name: project.name })}
				isLoading={deleteMutation.isPending}
				onConfirm={() => deleteMutation.mutate({ id: project.id })}
				onOpenChange={setDeleteOpen}
				open={deleteOpen}
				title={t("deleteProject")}
				variant="destructive"
			/>
		</>
	);
}

export default function ProjectsPage() {
	const t = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();
	const [filter, setFilter] = useState<StatusFilter>("ACTIVE");
	const [search, setSearch] = useState("");
	const [newProjectOpen, setNewProjectOpen] = useState(false);

	const {
		data: projects,
		isLoading,
		isError,
	} = api.project.list.useQuery(filter === "ALL" ? {} : { status: filter });

	const filteredProjects = projects?.filter((p) =>
		!search || p.name.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<>
			<SiteHeader title={t("title")} />
			<PageContent>
				<div className="space-y-4">
					{/* Search + Filter Tabs + New Project */}
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
								{FILTER_VALUES.map((value) => (
									<button
										className={cn(
											"cursor-pointer rounded-md px-3 py-1.5 font-medium text-sm transition-colors",
											filter === value
												? "bg-background shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
										key={value}
										onClick={() => setFilter(value)}
										type="button"
									>
										{value === "ACTIVE" ? t("active") : value === "ARCHIVED" ? t("archived") : t("all")}
									</button>
								))}
							</div>
							<ExpandableSearch
								value={search}
								onChange={setSearch}
								placeholder={t("searchPlaceholder")}
								slashFocus
							/>
						</div>
						<Button onClick={() => setNewProjectOpen(true)} size="sm">
							<Plus className="mr-1 h-4 w-4" />
							{t("newProject")}
						</Button>
					</div>

					{/* Projects Grid */}
					{isError ? (
						<div className="flex flex-col items-center justify-center py-24 text-center">
							<p className="text-muted-foreground text-sm">
								{t("loadError")}
							</p>
						</div>
					) : isLoading ? (
						<div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 400px), 1fr))" }}>
							{[...Array(6)].map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: skeleton
								<Skeleton className="h-[220px] rounded-xl" key={i} />
							))}
						</div>
					) : filteredProjects && filteredProjects.length > 0 ? (
						<div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 400px), 1fr))" }}>
							{filteredProjects.map((project) => (
								<ProjectCard
									filter={filter}
									formatCurrency={formatCurrency}
									key={project.id}
									project={project}
								/>
							))}
						</div>
					) : search ? (
						<EmptyState
							description={t("noSearchResults", { query: search })}
							icon={FolderOpen}
							title={t("noResults")}
						/>
					) : (
						<EmptyState
							action={{ label: t("newProject"), onClick: () => setNewProjectOpen(true) }}
							description={t("createDescription")}
							icon={FolderOpen}
							title={filter === "ALL" ? t("noProjectsYet") : t("noStatusProjects", { status: filter === "ACTIVE" ? t("active") : t("archived") })}
						/>
					)}
				</div>
			</PageContent>

			<NewProjectDialog
				onOpenChange={setNewProjectOpen}
				open={newProjectOpen}
			/>
		</>
	);
}

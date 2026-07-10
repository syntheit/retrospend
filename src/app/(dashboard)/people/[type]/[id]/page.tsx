"use client";

import { format } from "date-fns";
import {
	ArrowLeft,
	CheckCircle2,
	ChevronDown,
	Download,
	ExternalLink,
	FileSpreadsheet,
	FileText,
	Ghost,
	Bell,
	HandCoins,
	Layers,
	Link2,
	Receipt,
	ReceiptText,
	SlidersHorizontal,
	UserX,
	XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExpenseModal } from "~/components/expense-modal";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageContent } from "~/components/page-content";
import {
	PeopleTimelineTable,
	type AvailableCategory,
	type AvailablePayer,
} from "~/components/people/people-timeline-table";
import { useRevisionHistory } from "~/components/revision-history-provider";
import { SettleUpDialog } from "~/components/settle-up-dialog";
import { SiteHeader } from "~/components/site-header";
import { ExpandableSearch } from "~/components/table-search";
import { Badge } from "~/components/ui/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "~/components/ui/drawer";
import { ConfirmDialog } from "~/components/ui/confirmation-dialog";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCategoryName } from "~/hooks/use-category-name";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useIsMobile } from "~/hooks/use-mobile";
import { buildRateMap, computeHomeCurrencyTotal, formatSettleLabel } from "~/lib/balance-utils";
import { getCategoryIcon } from "~/lib/category-icons";
import { getImageUrl } from "~/lib/image-url";
import { usePageTitle } from "~/hooks/use-page-title";
import { cn, downloadCsv, downloadPdf } from "~/lib/utils";
import { api } from "~/trpc/react";

type ParticipantType = "user" | "guest" | "shadow";

const DEFAULT_DOT_COLOR = "bg-indigo-500";

function IdentityBadge({
	participantType,
	isVerifiedUser,
}: {
	participantType: ParticipantType;
	isVerifiedUser: boolean;
}) {
	const t = useTranslations("personDetail");
	if (isVerifiedUser) {
		return null;
	}
	if (participantType === "guest") {
		return (
			<Badge className="gap-1" variant="outline">
				<Ghost className="h-3 w-3" />
				{t("guest")}
			</Badge>
		);
	}
	return (
		<Badge className="gap-1 text-muted-foreground" variant="outline">
			<UserX className="h-3 w-3" />
			{t("notOnRetrospend")}
		</Badge>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type PageParams = Promise<{ type: string; id: string }>;

export default function PersonDetailPage({ params }: { params: PageParams }) {
	const t = useTranslations("personDetail");
	const { type, id } = use(params);
	const participantType = type as ParticipantType;
	const router = useRouter();
	const { formatCurrency } = useCurrencyFormatter();
	const { displayName } = useCategoryName();
	const { openHistory } = useRevisionHistory();
	const { openNewExpense } = useExpenseModal();

	const isMobile = useIsMobile();

	const [settleUpOpen, setSettleUpOpen] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<
		string | null | undefined
	>(undefined);
	const [statusFilter, setStatusFilter] = useState<"all" | "active">("active");
	const [expenseCount, setExpenseCount] = useState<number | null>(null);
	const [searchValue, setSearchValue] = useState("");
	const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
	const [paidByFilter, setPaidByFilter] = useState<"all" | "me" | "them">("all");
	const [availableCategories, setAvailableCategories] = useState<AvailableCategory[]>([]);
	const [availablePayers, setAvailablePayers] = useState<AvailablePayer[]>([]);
	const [filterOpen, setFilterOpen] = useState(false);

	const onAvailableCategoriesChange = useCallback((cats: AvailableCategory[]) => {
		setAvailableCategories((prev) => {
			if (prev.length === cats.length && prev.every((c, i) => c.id === cats[i]?.id)) return prev;
			return cats;
		});
	}, []);

	const onAvailablePayersChange = useCallback((payers: AvailablePayer[]) => {
		setAvailablePayers((prev) => {
			if (prev.length === payers.length && prev.every((p, i) => p.isMe === payers[i]?.isMe)) return prev;
			return payers;
		});
	}, []);

	const activeFilterCount = selectedCategories.size + (paidByFilter !== "all" ? 1 : 0);

	function toggleCategory(catId: string) {
		setSelectedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(catId)) next.delete(catId);
			else next.add(catId);
			return next;
		});
	}

	function clearFilters() {
		setSelectedCategories(new Set());
		setPaidByFilter("all");
	}
	const [editingTransactionId, setEditingTransactionId] = useState<
		string | null
	>(null);
	const [deletingTransaction, setDeletingTransaction] = useState<{
		id: string;
		description: string;
		amount: number;
		currency: string;
		date: Date;
	} | null>(null);

	const utils = api.useUtils();
	const deleteMutation = api.sharedTransaction.delete.useMutation({
		onSuccess: () => {
			toast.success(t("expenseDeleted"));
			void utils.people.detail.invalidate({
				participantType,
				participantId: id,
			});
			void utils.people.detailCursor.invalidate();
			void utils.people.list.invalidate();
			setDeletingTransaction(null);
		},
		onError: (e) => {
			toast.error(e.message);
			setDeletingTransaction(null);
		},
	});

	const exportHistoryMutation = api.exportData.exportPersonHistory.useMutation();
	const exportSettlementMutation = api.exportData.exportPersonSettlementPlan.useMutation();
	const exportPdfMutation = api.exportData.exportPersonPdf.useMutation();

	const isExporting =
		exportHistoryMutation.isPending ||
		exportSettlementMutation.isPending ||
		exportPdfMutation.isPending;

	const handleExportHistory = async () => {
		try {
			const { csv, filename } = await exportHistoryMutation.mutateAsync({
				participantType,
				participantId: id,
				format: "csv",
			});
			downloadCsv(csv, filename);
			toast.success(t("csvExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToExportCsv"),
			);
		}
	};

	const handleExportSettlement = async () => {
		try {
			const { csv, filename } = await exportSettlementMutation.mutateAsync({
				participantType,
				participantId: id,
				format: "csv",
			});
			downloadCsv(csv, filename);
			toast.success(t("settlementPlanExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToExportSettlement"),
			);
		}
	};

	const handleExportPdf = async () => {
		try {
			const { pdf, filename } = await exportPdfMutation.mutateAsync({
				participantType,
				participantId: id,
			});
			downloadPdf(pdf, filename);
			toast.success(t("pdfExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToExportPdf"),
			);
		}
	};

	// Detail query for header data (identity, balances, stats, breakdown)
	const { data, isLoading, isError } = api.people.detail.useQuery({
		participantType,
		participantId: id,
		page: 1,
		limit: 1,
	});

	// User settings for home currency
	const { data: settings } = api.settings.getGeneral.useQuery(undefined, {
		staleTime: 30 * 60 * 1000,
	});

	// All exchange rates for home currency conversion
	const { data: allRates } = api.exchangeRate.getAllRates.useQuery(undefined, {
		staleTime: 60 * 60 * 1000,
	});

	// Project list for filter card metadata (type, imagePath)
	const { data: projectList } = api.project.list.useQuery(
		{},
		{ staleTime: 5 * 60 * 1000 },
	);

	// Pending settlements where I am the payee (for this participant)
	const { data: pendingSettlements } = api.settlement.history.useQuery(
		{ participantType, participantId: id },
		{ enabled: !isLoading },
	);
	const pendingForMe = useMemo(
		() => (pendingSettlements ?? []).filter(
			(s) => s.canConfirm && s.status === "pending_payee_confirmation",
		),
		[pendingSettlements],
	);

	const confirmSettlement = api.settlement.confirm.useMutation({
		onSuccess: () => {
			toast.success(t("settlementConfirmed"));
			void utils.people.detail.invalidate();
			void utils.people.detailCursor.invalidate();
			void utils.people.list.invalidate();
			void utils.settlement.history.invalidate();
			void utils.settlement.plan.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const rejectSettlement = api.settlement.reject.useMutation({
		onSuccess: () => {
			toast.success(t("settlementRejected"));
			void utils.people.detail.invalidate();
			void utils.people.detailCursor.invalidate();
			void utils.people.list.invalidate();
			void utils.settlement.history.invalidate();
			void utils.settlement.plan.invalidate();
		},
		onError: (e) => toast.error(e.message),
	});

	const [reminderSent, setReminderSent] = useState(false);
	const remindPayment = api.settlement.requestPayment.useMutation({
		onSuccess: () => {
			toast.success(t("reminderSentToast"));
			setReminderSent(true);
			setTimeout(() => setReminderSent(false), 5000);
		},
		onError: (e) => toast.error(e.message),
	});

	const identity = data?.identity;
	const balances = data?.balances ?? [];

	usePageTitle(identity?.name);
	const relationshipStats = data?.relationshipStats;
	const projectBreakdown = data?.projectBreakdown ?? [];
	const hasHistory = (relationshipStats?.transactionCount ?? 0) > 0;

	const isSettled =
		balances.length === 0 || balances.every((b) => b.balance === 0);

	// Build a lookup map: projectId -> project metadata
	const projectMetaMap = useMemo(() => {
		const map = new Map<
			string,
			{
				imagePath: string | null;
				myRole: string | null;
				status: string;
				primaryCurrency: string;
				name: string;
			}
		>();
		if (projectList) {
			for (const p of projectList) {
				map.set(p.id, {
					imagePath: p.imagePath ?? null,
					myRole: p.myRole,
					status: p.status,
					primaryCurrency: p.primaryCurrency,
					name: p.name,
				});
			}
		}
		return map;
	}, [projectList]);

	// Compute home currency totals
	const homeCurrency = settings?.homeCurrency ?? "USD";

	const rateMap = useMemo(() => buildRateMap(allRates), [allRates]);

	const homeCurrencyTotal = useMemo(
		() => computeHomeCurrencyTotal(balances, homeCurrency, rateMap),
		[balances, homeCurrency, rateMap],
	);

	// Compute home currency total per project for filter pills
	const projectHomeTotals = useMemo(() => {
		const map = new Map<
			string | null,
			{ amount: number; canConvert: boolean } | null
		>();
		for (const proj of projectBreakdown) {
			map.set(
				proj.projectId,
				computeHomeCurrencyTotal(proj.balances, homeCurrency, rateMap),
			);
		}
		return map;
	}, [projectBreakdown, homeCurrency, rateMap]);

	// Determine overall direction from home currency total or primary balance
	const netDirection = useMemo(() => {
		if (homeCurrencyTotal && homeCurrencyTotal.canConvert) {
			if (homeCurrencyTotal.amount > 0) return "they_owe_you" as const;
			if (homeCurrencyTotal.amount < 0) return "you_owe_them" as const;
			return "settled" as const;
		}
		const primary = balances[0];
		if (!primary) return "settled" as const;
		return primary.direction;
	}, [homeCurrencyTotal, balances]);

	// Compute action-specific settle button label
	const settleButtonLabel = useMemo(() => {
		if (isSettled || !identity) return "";
		return formatSettleLabel(netDirection, homeCurrencyTotal, homeCurrency, balances, formatCurrency, {
			pay: (amount) => t("payAmount", { amount }),
			request: (amount) => t("requestAmount", { amount }),
		});
	}, [isSettled, identity, homeCurrencyTotal, homeCurrency, formatCurrency, balances, netDirection, t]);

	const filterPanel = (
		<div className="space-y-3">
			{availableCategories.length > 0 && (
				<div className="space-y-1.5">
					<p className="font-medium text-muted-foreground text-xs tracking-wide">
						{t("category")}
					</p>
					<div className="flex flex-wrap gap-1.5">
						{availableCategories.map((cat) => {
							const Icon = getCategoryIcon(cat.name, cat.icon);
							return (
								<Button
									aria-pressed={selectedCategories.has(cat.id)}
									className="h-7 gap-1.5 px-2.5 text-xs"
									key={cat.id}
									onClick={() => toggleCategory(cat.id)}
									size="sm"
									variant={selectedCategories.has(cat.id) ? "default" : "outline"}
								>
									<Icon
										className={cn(
											"h-3 w-3 shrink-0",
											!selectedCategories.has(cat.id) &&
												`text-${cat.color}-500`,
										)}
									/>
									{displayName(cat.name)}
								</Button>
							);
						})}
					</div>
				</div>
			)}
			{availablePayers.length > 0 && (
				<div className="space-y-1.5">
					<p className="font-medium text-muted-foreground text-xs tracking-wide">
						{t("paidBy")}
					</p>
					<div className="flex flex-wrap gap-1.5">
						{availablePayers.map((payer) => {
							const key = payer.isMe ? "me" : "them";
							const isSelected = paidByFilter === key;
							return (
								<Button
									aria-pressed={isSelected}
									className="h-7 gap-1.5 px-2.5 text-xs"
									key={key}
									onClick={() => setPaidByFilter(isSelected ? "all" : key)}
									size="sm"
									variant={isSelected ? "default" : "outline"}
								>
									<UserAvatar
										avatarUrl={payer.avatarUrl}
										className="h-4 w-4 text-[8px]"
										name={payer.name}
										size="xs"
									/>
									{payer.isMe ? t("you") : payer.name.split(" ")[0]}
								</Button>
							);
						})}
					</div>
				</div>
			)}
			{activeFilterCount > 0 && (
				<Button
					className="h-7 px-2.5 text-xs"
					onClick={clearFilters}
					size="sm"
					variant="ghost"
				>
					{t("clearFilters")}
				</Button>
			)}
		</div>
	);

	if (isError) {
		return (
			<>
				<SiteHeader title={t("personNotFound")} />
				<PageContent>
					<div className="flex h-64 flex-col items-center justify-center gap-3">
						<p className="text-muted-foreground">
							{t("personCouldNotBeFound")}
						</p>
						<Button asChild variant="outline">
							<Link href="/people">
								<ArrowLeft className="mr-2 h-4 w-4" />
								{t("backToPeople")}
							</Link>
						</Button>
					</div>
				</PageContent>
			</>
		);
	}

	return (
		<>
			<SiteHeader
				title={
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="/people">{t("people")}</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>
									{isLoading ? (
										<Skeleton className="h-4 w-36" />
									) : (
										(identity?.name ?? t("person"))
									)}
								</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				}
			/>
			<PageContent>
				<div className="flex flex-col gap-4">
					{/* Person Header */}
					{isLoading ? (
						<div className="flex items-start gap-4">
							<Skeleton className="h-16 w-16 rounded-full" />
							<div className="space-y-2">
								<Skeleton className="h-6 w-40" />
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-8 w-28" />
							</div>
						</div>
					) : (
						<div className={cn("flex flex-col gap-4", hasHistory && "sm:grid sm:grid-cols-[1fr_auto] sm:gap-x-6 sm:gap-y-0")}>
							{/* Left: avatar + name/stats + pills */}
							<div className="flex flex-col gap-4">
								<div className="flex items-center gap-4">
								<UserAvatar
									avatarUrl={identity?.avatarUrl}
									name={identity?.name ?? "?"}
									size="xl"
								/>
								<div className="space-y-2">
									<div className="flex flex-wrap items-center gap-2">
										<h2 className="font-bold text-2xl">{identity?.name}</h2>
										{identity && (
											<IdentityBadge
												isVerifiedUser={identity.isVerifiedUser}
												participantType={
													identity.participantType as ParticipantType
												}
											/>
										)}
									</div>
									{identity?.isVerifiedUser && identity.username ? (
										<p className="text-muted-foreground text-sm">
											@{identity.username}
										</p>
									) : !identity?.isVerifiedUser && identity?.email ? (
										<p className="text-muted-foreground text-sm">
											{identity.email}
										</p>
									) : null}
									{relationshipStats &&
										relationshipStats.transactionCount > 0 && (
											<p className="text-muted-foreground text-sm tabular-nums">
												{relationshipStats.firstTransactionDate
													? t("sharingSince", { date: new Date(relationshipStats.firstTransactionDate).toLocaleDateString(undefined, { month: "short", year: "numeric" }) })
													: ""}
												{relationshipStats.firstTransactionDate ? " · " : ""}
												{t("expenseCount", { count: relationshipStats.transactionCount })}
												{relationshipStats.projectCount > 0
													? ` · ${t("projectCount", { count: relationshipStats.projectCount })}`
													: ""}
											</p>
										)}
								</div>
							</div>
																						{/* Per-project filter pills + table controls */}
								{!isLoading && hasHistory && (
									<div className="-mx-4 flex flex-col gap-4 px-4 sm:mx-0 sm:px-0">
										{projectBreakdown.length > 0 && (
											<div className="flex gap-2 overflow-x-auto pb-1">
												{/* All pill */}
												<ContextMenu>
													<ContextMenuTrigger asChild>
														<button
															className={cn(
																"flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
																selectedProjectId === undefined
																	? "border-primary bg-primary text-primary-foreground"
																	: "border-border bg-secondary hover:bg-accent",
															)}
															onClick={() => setSelectedProjectId(undefined)}
															type="button"
														>
															<span>{t("all")}</span>
															{isSettled ? (
																<CheckCircle2
																	className={cn(
																		"h-3 w-3",
																		selectedProjectId === undefined
																			? "text-primary-foreground/80"
																			: "text-emerald-500",
																	)}
																/>
															) : homeCurrencyTotal &&
																homeCurrencyTotal.canConvert ? (
																<span
																	className={cn(
																		"tabular-nums text-xs",
																		selectedProjectId === undefined
																			? "text-primary-foreground/80"
																			: netDirection === "they_owe_you"
																				? "text-emerald-600 dark:text-emerald-400"
																				: "text-rose-600 dark:text-rose-400",
																	)}
																>
																	{formatCurrency(
																		Math.abs(homeCurrencyTotal.amount),
																		homeCurrency,
																	)}
																</span>
															) : null}
														</button>
													</ContextMenuTrigger>
													{!isSettled && (
														<ContextMenuContent>
															<ContextMenuItem onClick={() => setSettleUpOpen(true)}>
																<CheckCircle2 className="h-4 w-4" />
																{t("settleUp")}
															</ContextMenuItem>
														</ContextMenuContent>
													)}
												</ContextMenu>

												{projectBreakdown.map((proj) => {
													const projKey = proj.projectId ?? "__standalone__";
													const isSelected = selectedProjectId === proj.projectId;
													const meta = proj.projectId
														? projectMetaMap.get(proj.projectId)
														: undefined;
													const imageUrl = getImageUrl(meta?.imagePath ?? null);
													const projTotal = projectHomeTotals.get(proj.projectId);
													const projIsEven = !projTotal || projTotal.amount === 0;
													const canAddExpense =
														meta &&
														meta.status !== "ARCHIVED" &&
														meta.myRole !== "VIEWER";
													const hasProject = !!proj.projectId;

													return (
														<ContextMenu key={projKey}>
															<ContextMenuTrigger asChild>
																<button
																	className={cn(
																		"flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
																		isSelected
																			? "border-primary bg-primary text-primary-foreground"
																			: "border-border bg-secondary hover:bg-accent",
																	)}
																	onClick={(e) => {
																		if ((e.ctrlKey || e.metaKey) && proj.projectId) {
																			window.open(
																				`/projects/${proj.projectId}`,
																				"_blank",
																			);
																			return;
																		}
																		setSelectedProjectId(
																			isSelected ? undefined : proj.projectId,
																		);
																	}}
																	type="button"
																>
																	{imageUrl ? (
																		<img
																			alt=""
																			className="h-4 w-4 shrink-0 rounded-full object-cover"
																			src={imageUrl}
																		/>
																	) : !proj.projectId ? (
																		<Layers
																			className={cn(
																				"h-4 w-4 shrink-0",
																				isSelected
																					? "text-primary-foreground/70"
																					: "text-muted-foreground",
																			)}
																		/>
																	) : (
																		<span
																			className={cn(
																				"h-4 w-4 shrink-0 rounded-full",
																				DEFAULT_DOT_COLOR,
																			)}
																		/>
																	)}
																	<span className="max-w-[150px] truncate">
																		{proj.projectName ?? t("standalone")}
																	</span>
																	{projIsEven ? (
																		<CheckCircle2
																			className={cn(
																				"h-3 w-3",
																				isSelected
																					? "text-primary-foreground/80"
																					: "text-emerald-500",
																			)}
																		/>
																	) : projTotal && projTotal.canConvert ? (
																		<span
																			className={cn(
																				"tabular-nums text-xs",
																				isSelected
																					? "text-primary-foreground/80"
																					: projTotal.amount > 0
																						? "text-emerald-600 dark:text-emerald-400"
																						: "text-rose-600 dark:text-rose-400",
																			)}
																		>
																			{formatCurrency(
																				Math.abs(projTotal.amount),
																				homeCurrency,
																			)}
																		</span>
																	) : null}
																</button>
															</ContextMenuTrigger>
															<ContextMenuContent>
																{hasProject && (
																	<ContextMenuItem
																		onClick={() =>
																			router.push(`/projects/${proj.projectId}`)
																		}
																	>
																		<ExternalLink className="h-4 w-4" />
																		{t("openProject")}
																	</ContextMenuItem>
																)}
																{canAddExpense && (
																	<ContextMenuItem
																		onClick={() =>
																			openNewExpense({
																				projectId: proj.projectId!,
																				projectName: meta!.name,
																				projectDefaultCurrency: meta!.primaryCurrency,
																			})
																		}
																	>
																		<ReceiptText className="h-4 w-4" />
																		{t("addExpense")}
																	</ContextMenuItem>
																)}
																{hasProject && (
																	<ContextMenuItem
																		onClick={() => {
																			const url = `${window.location.origin}/projects/${proj.projectId}`;
																			void navigator.clipboard.writeText(url);
																			toast.success(t("linkCopied"));
																		}}
																	>
																		<Link2 className="h-4 w-4" />
																		{t("copyLink")}
																	</ContextMenuItem>
																)}
																{!projIsEven && (
																	<>
																		{hasProject && <ContextMenuSeparator />}
																		<ContextMenuItem
																			onClick={() => setSettleUpOpen(true)}
																		>
																			<CheckCircle2 className="h-4 w-4" />
																			{t("settleUp")}
																		</ContextMenuItem>
																	</>
																)}
															</ContextMenuContent>
														</ContextMenu>
													);
												})}
											</div>
										)}
										<div className="flex items-center gap-2">
											{expenseCount !== null && (
												<span className="shrink-0 text-muted-foreground text-sm tabular-nums">
													{t("expenseCount", { count: expenseCount })}
												</span>
											)}
											<div className="flex rounded-lg border border-border p-0.5">
												{(["all", "active"] as const).map((filter) => (
													<button
														className={cn(
															"cursor-pointer rounded-md px-2.5 py-1 font-medium text-xs transition-colors",
															statusFilter === filter
																? "bg-primary text-primary-foreground"
																: "text-muted-foreground hover:text-foreground",
														)}
														key={filter}
														onClick={() => setStatusFilter(filter)}
														type="button"
													>
														{filter === "all" ? t("all") : t("outstanding")}
													</button>
												))}
											</div>
											{isMobile ? (
												<>
													<Button
														className="relative h-7 px-2 text-xs"
														onClick={() => setFilterOpen(true)}
														size="sm"
														variant={activeFilterCount > 0 ? "secondary" : "ghost"}
													>
														<SlidersHorizontal className="h-3.5 w-3.5" />
														{t("filters")}
														{activeFilterCount > 0 && (
															<span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground">
																{activeFilterCount}
															</span>
														)}
													</Button>
													<Drawer
														direction="bottom"
														onOpenChange={setFilterOpen}
														open={filterOpen}
													>
														<DrawerContent className="px-6 pb-8">
															<DrawerTitle className="mb-2 text-left font-semibold text-lg">
																{t("filters")}
															</DrawerTitle>
															<DrawerDescription className="sr-only">
																{t("filterExpensesDescription")}
															</DrawerDescription>
															<div className="overflow-y-auto">{filterPanel}</div>
														</DrawerContent>
													</Drawer>
												</>
											) : (
												<Popover onOpenChange={setFilterOpen} open={filterOpen}>
													<PopoverTrigger asChild>
														<Button
															className="relative h-7 px-2 text-xs"
															size="sm"
															variant={activeFilterCount > 0 ? "secondary" : "ghost"}
														>
															<SlidersHorizontal className="h-3.5 w-3.5" />
															{t("filters")}
															{activeFilterCount > 0 && (
																<span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground">
																	{activeFilterCount}
																</span>
															)}
														</Button>
													</PopoverTrigger>
													<PopoverContent
														align="start"
														className="w-[400px] p-4"
														sideOffset={8}
													>
														{filterPanel}
													</PopoverContent>
												</Popover>
											)}
											<ExpandableSearch
												onChange={setSearchValue}
												placeholder={t("searchExpenses")}
												value={searchValue}
												slashFocus
											/>
										</div>
									</div>
								)}
							</div>

							{/* Right: Actions + Balance */}
							{hasHistory && <div className="flex flex-col items-start gap-3 sm:items-end">
								{/* Action buttons */}
								<div className="flex flex-wrap items-center gap-1.5">
									{!isSettled && (
										<Button onClick={() => setSettleUpOpen(true)} size="sm">
											{settleButtonLabel}
										</Button>
									)}
									{!isSettled && netDirection === "they_owe_you" && participantType === "user" && (
										<Button
											disabled={remindPayment.isPending || reminderSent}
											onClick={() => remindPayment.mutate({ participantType, participantId: id })}
											size="sm"
											variant="outline"
										>
											{reminderSent ? (
												<>
													<CheckCircle2 className="h-4 w-4" />
													{t("sent")}
												</>
											) : (
												<>
													<Bell className="h-4 w-4" />
													{remindPayment.isPending ? t("sending") : t("remind")}
												</>
											)}
										</Button>
									)}
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												disabled={isExporting}
												size="sm"
												variant="ghost"
												className="focus-visible:ring-0 focus-visible:ring-offset-0"
											>
												<Download className="h-4 w-4" />
												{isExporting ? t("exporting") : t("export")}
												<ChevronDown className="h-3 w-3 opacity-60" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem onClick={handleExportHistory}>
												<FileSpreadsheet className="mr-2 h-4 w-4" />
												{t("exportHistoryCsv")}
											</DropdownMenuItem>
											{!isSettled && (
												<DropdownMenuItem onClick={handleExportSettlement}>
													<Receipt className="mr-2 h-4 w-4" />
													{t("exportSettlementPlan")}
												</DropdownMenuItem>
											)}
											<DropdownMenuItem onClick={handleExportPdf}>
												<FileText className="mr-2 h-4 w-4" />
												{t("downloadPdfSummary")}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
{/* Balance hero */}
								<div className="flex flex-col items-start gap-0.5 sm:items-end sm:text-right">
									{isSettled ? (
										<div className="flex items-center gap-2 font-semibold text-xl text-emerald-600 dark:text-emerald-400">
											<CheckCircle2 className="h-5 w-5" />
											{t("allSettledUp")}
										</div>
									) : (
										<>
											{/* Home currency total */}
											{homeCurrencyTotal && homeCurrencyTotal.canConvert ? (
												<>
													<p className="text-muted-foreground text-sm">
														{netDirection === "they_owe_you"
															? t("theyOweYou")
															: t("youOweThem")}
													</p>
													<span
														className={cn(
															"font-semibold text-xl tabular-nums",
															netDirection === "they_owe_you"
																? "text-emerald-600 dark:text-emerald-400"
																: "text-rose-600 dark:text-rose-400",
														)}
													>
														{formatCurrency(
															Math.abs(homeCurrencyTotal.amount),
															homeCurrency,
														)}
													</span>
													{balances.some(b => b.currency !== homeCurrency) && (
														<div className="mt-1 flex flex-wrap justify-end gap-2">
															{balances.map((b) => (
																<span key={b.currency} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/10 px-3 py-1.5">
																	<CurrencyFlag
																		className="!h-3.5 !w-3.5"
																		currencyCode={b.currency}
																	/>
																	<span className="text-sm font-semibold leading-none text-foreground tabular-nums">{formatCurrency(b.balance, b.currency)}</span>
																	<span className="text-xs leading-none text-muted-foreground">{b.currency}</span>
																</span>
															))}
														</div>
													)}
												</>
											) : (
												/* Fallback: show per-currency amounts without total */
												<>
													<p className="text-muted-foreground text-sm">
														{netDirection === "they_owe_you"
															? t("theyOweYou")
															: netDirection === "you_owe_them"
																? t("youOweThem")
																: ""}
													</p>
													<div className="mt-1 flex flex-wrap justify-end gap-2">
														{balances.map((b) => (
															<span key={b.currency} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/10 px-3 py-1.5">
																<CurrencyFlag
																	className="!h-3.5 !w-3.5"
																	currencyCode={b.currency}
																/>
																<span className={cn(
																	"text-sm font-semibold leading-none tabular-nums",
																	b.direction === "they_owe_you"
																		? "text-emerald-600 dark:text-emerald-400"
																		: "text-rose-600 dark:text-rose-400",
																)}>{formatCurrency(b.balance, b.currency)}</span>
																<span className="text-xs leading-none text-muted-foreground">{b.currency}</span>
															</span>
														))}
													</div>
												</>
											)}
										</>
									)}
								</div>
							</div>}
						</div>
					)}


					{/* Pending settlement banner (Issue 2) */}
					{pendingForMe.length > 0 && (
						<div className="space-y-2">
							{pendingForMe.map((s) => (
								<div
									key={s.id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30"
								>
									<div className="flex items-center gap-2 text-sm">
										<HandCoins className="h-4 w-4 text-amber-600 dark:text-amber-400" />
										<span>
											{t("settlementBanner", {
												name: identity?.name ?? t("they"),
												amount: formatCurrency(s.amount, s.currency),
											})}
										</span>
									</div>
									<div className="flex items-center gap-1.5">
										<Button
											disabled={confirmSettlement.isPending}
											onClick={() => confirmSettlement.mutate({ id: s.id })}
											size="sm"
										>
											<CheckCircle2 className="h-3.5 w-3.5" />
											{t("confirm")}
										</Button>
										<Button
											disabled={rejectSettlement.isPending}
											onClick={() => rejectSettlement.mutate({ id: s.id })}
											size="sm"
											variant="outline"
										>
											<XCircle className="h-3.5 w-3.5" />
											{t("reject")}
										</Button>
									</div>
								</div>
							))}
						</div>
					)}

					{isLoading || hasHistory ? (
						<PeopleTimelineTable
							externalToolbar
							identityName={identity?.name ?? t("they")}
							onAvailableCategoriesChange={onAvailableCategoriesChange}
							onAvailablePayersChange={onAvailablePayersChange}
							onCountChange={setExpenseCount}
							onDelete={(txn) => setDeletingTransaction(txn)}
							onEdit={(txnId) => setEditingTransactionId(txnId)}
							onSearchChange={setSearchValue}
							onStatusFilterChange={setStatusFilter}
							onViewHistory={(txnId) => openHistory(txnId)}
							paidByFilter={paidByFilter}
							participantId={id}
							participantType={participantType}
							searchValue={searchValue}
							selectedCategories={selectedCategories}
							selectedProjectId={selectedProjectId}
							statusFilter={statusFilter}
						/>
					) : (
						<div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
							<ReceiptText className="mb-3 h-10 w-10 text-muted-foreground/40" />
							<h3 className="font-medium">{t("noSharedExpenses")}</h3>
							<p className="mt-1 max-w-sm text-muted-foreground text-sm">
								{t("noSharedExpensesDescription", { name: identity?.name ?? t("thisPerson") })}
							</p>
							{identity?.isVerifiedUser && identity?.username && (
								<Button asChild className="mt-4" size="sm" variant="outline">
									<Link href={`/u/${identity.username}`}>
										<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
										{t("viewPublicProfile")}
									</Link>
								</Button>
							)}
						</div>
					)}
				</div>
			</PageContent>

			{identity && (
				<SettleUpDialog
					onClose={() => setSettleUpOpen(false)}
					open={settleUpOpen}
					participantId={id}
					participantType={participantType}
					personAvatarUrl={identity.avatarUrl}
					personName={identity.name}
				/>
			)}
			{editingTransactionId && (
				<ExpenseModal
					expenseId=""
					mode="edit"
					onOpenChange={(open) => {
						if (!open) setEditingTransactionId(null);
					}}
					open={!!editingTransactionId}
					sharedTransactionId={editingTransactionId}
					title={t("editExpense")}
				/>
			)}

			<ConfirmDialog
				confirmText={t("deleteButton")}
				description={
					deletingTransaction ? (
						<span>
							<strong>{deletingTransaction.description}</strong>
							<br />
							{formatCurrency(
								deletingTransaction.amount,
								deletingTransaction.currency,
							)}{" "}
							· {format(new Date(deletingTransaction.date), "MMM d, yyyy")}
							<br />
							<span className="text-destructive text-xs">
								{t("deleteExpenseWarning")}
							</span>
						</span>
					) : undefined
				}
				isLoading={deleteMutation.isPending}
				onConfirm={() => {
					if (deletingTransaction) {
						deleteMutation.mutate({ id: deletingTransaction.id });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setDeletingTransaction(null);
				}}
				open={!!deletingTransaction}
				title={t("deleteExpenseTitle")}
				variant="destructive"
			/>
		</>
	);
}

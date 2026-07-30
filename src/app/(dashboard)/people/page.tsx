"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	ArrowDownLeft,
	ArrowRight,
	ArrowUpRight,
	Check,
	ChevronUp,
	Handshake,
	Scale,
	Users,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { PageContent } from "~/components/page-content";
import {
	type ActivityTableRow,
	createActivityColumns,
} from "~/components/people/activity-table-columns";
import { SettleUpDialog } from "~/components/settle-up-dialog";
import { SiteHeader } from "~/components/site-header";
import { UserAvatar } from "~/components/ui/user-avatar";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { Skeleton } from "~/components/ui/skeleton";
import { TableSearch } from "~/components/table-search";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useSettings } from "~/hooks/use-settings";
import { buildRateMap, computeHomeCurrencyTotal, formatSettleLabel } from "~/lib/balance-utils";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

function getPrimaryDirection(
	balances: { balance: number; currency: string; direction: string }[],
): "they_owe_you" | "you_owe_them" | "settled" {
	if (balances.length === 0) return "settled";
	const nonZero = balances.find((b) => b.balance > 0);
	return (nonZero?.direction ?? "settled") as
		| "they_owe_you"
		| "you_owe_them"
		| "settled";
}

const BANNER_MAX_ITEMS = 3;

type SortOption = "balance" | "name" | "recent";
type ActivityFilter = "all" | "splits" | "settlements";

export default function PeoplePage() {
	const t = useTranslations("people");
	const router = useRouter();
	const { data: settings } = useSettings();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const { formatCurrency } = useCurrencyFormatter();
	const { data: people, isLoading: peopleLoading } = api.people.list.useQuery();
	const {
		data: queue,
		isLoading: queueLoading,
		refetch: refetchQueue,
	} = api.verification.queue.useQuery();

	const { data: allRates } = api.exchangeRate.getAllRates.useQuery(undefined, {
		staleTime: 60 * 60 * 1000,
	});

	const { data: recentActivity, isLoading: activityLoading } =
		api.dashboard.getRecentActivity.useQuery({ homeCurrency });

	const utils = api.useUtils();

	// Per-item loading and exit animation tracking
	const [actioningId, setActioningId] = useState<string | null>(null);
	const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
	const [bannerExpanded, setBannerExpanded] = useState(false);
	const [settleTarget, setSettleTarget] = useState<{
		participantType: "user" | "guest" | "shadow";
		participantId: string;
		name: string;
		avatarUrl?: string | null;
	} | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [sortBy, setSortBy] = useState<SortOption>("balance");
	const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

	const acceptMutation = api.verification.accept.useMutation({
		onMutate: ({ txnId }) => {
			setActioningId(txnId);
			setExitingIds((prev) => new Set(prev).add(txnId));
		},
		onSuccess: (_data, { txnId }) => {
			toast.success(t("verified"));
			setTimeout(() => {
				setExitingIds((prev) => {
					const next = new Set(prev);
					next.delete(txnId);
					return next;
				});
				void refetchQueue();
				void utils.people.list.invalidate();
			}, 300);
		},
		onError: (e, { txnId }) => {
			setExitingIds((prev) => {
				const next = new Set(prev);
				next.delete(txnId);
				return next;
			});
			toast.error(e.message);
		},
		onSettled: () => setActioningId(null),
	});

	const rejectMutation = api.verification.reject.useMutation({
		onMutate: ({ txnId }) => {
			setActioningId(txnId);
			setExitingIds((prev) => new Set(prev).add(txnId));
		},
		onSuccess: (_data, { txnId }) => {
			toast.success(t("rejected"));
			setTimeout(() => {
				setExitingIds((prev) => {
					const next = new Set(prev);
					next.delete(txnId);
					return next;
				});
				void refetchQueue();
				void utils.people.list.invalidate();
			}, 300);
		},
		onError: (e, { txnId }) => {
			setExitingIds((prev) => {
				const next = new Set(prev);
				next.delete(txnId);
				return next;
			});
			toast.error(e.message);
		},
		onSettled: () => setActioningId(null),
	});

	// Build exchange rate lookup map
	const rateMap = useMemo(() => buildRateMap(allRates), [allRates]);

	// Pre-compute home currency total per person
	type PersonWithTotal = NonNullable<typeof people>[number] & {
		homeCurrencyTotal: { amount: number; canConvert: boolean } | null;
	};

	const peopleWithTotals: PersonWithTotal[] = useMemo(() => {
		if (!people) return [];
		return people.map((p) => ({
			...p,
			homeCurrencyTotal: computeHomeCurrencyTotal(p.balances, homeCurrency, rateMap),
		}));
	}, [people, homeCurrency, rateMap]);

	// Compute summary stats using home currency conversion
	const stats = useMemo(() => {
		let receivable = 0;
		let payable = 0;
		let activeCount = 0;
		for (const person of peopleWithTotals) {
			if (getPrimaryDirection(person.balances) !== "settled") activeCount++;
			if (person.homeCurrencyTotal?.canConvert) {
				if (person.homeCurrencyTotal.amount > 0) receivable += person.homeCurrencyTotal.amount;
				else if (person.homeCurrencyTotal.amount < 0) payable += Math.abs(person.homeCurrencyTotal.amount);
			}
		}
		return { receivable, payable, net: receivable - payable, activeCount };
	}, [peopleWithTotals]);

	// Filter by name, username, or email
	const filtered = useMemo(() => {
		if (!searchQuery.trim()) return peopleWithTotals;
		const q = searchQuery.trim().toLowerCase();
		return peopleWithTotals.filter((p) =>
			p.identity.name.toLowerCase().includes(q) ||
			(p.identity.username && p.identity.username.toLowerCase().includes(q)) ||
			(p.identity.email && p.identity.email.toLowerCase().includes(q)),
		);
	}, [peopleWithTotals, searchQuery]);

	// Partition into active + settled, sort within each, then concatenate (settled at bottom)
	const sortedPeople = useMemo(() => {
		const active = filtered.filter((p) => getPrimaryDirection(p.balances) !== "settled");
		const settled = filtered.filter((p) => getPrimaryDirection(p.balances) === "settled");

		const sortFn = (list: PersonWithTotal[]) =>
			[...list].sort((a, b) => {
				switch (sortBy) {
					case "balance":
						return Math.abs(b.homeCurrencyTotal?.amount ?? 0) - Math.abs(a.homeCurrencyTotal?.amount ?? 0);
					case "recent":
						return (
							new Date(b.mostRecentTransactionDate ?? 0).getTime() -
							new Date(a.mostRecentTransactionDate ?? 0).getTime()
						);
					case "name":
						return a.identity.name.localeCompare(b.identity.name);
					default:
						return 0;
				}
			});

		return [...sortFn(active), ...sortFn(settled)];
	}, [filtered, sortBy]);

	// Build avatar lookup for timeline (name → avatarUrl)
	const avatarMap = useMemo(() => {
		const map = new Map<string, string | null>();
		if (!people) return map;
		for (const p of people) {
			map.set(p.identity.name.toLowerCase(), p.identity.avatarUrl);
			if (p.identity.username) {
				map.set(p.identity.username.toLowerCase(), p.identity.avatarUrl);
			}
		}
		return map;
	}, [people]);

	// Build person lookup for timeline navigation (name → href)
	const personHrefMap = useMemo(() => {
		const map = new Map<string, string>();
		if (!people) return map;
		for (const p of people) {
			map.set(
				p.identity.name.toLowerCase(),
				`/people/${p.identity.participantType}/${p.identity.participantId}`,
			);
		}
		return map;
	}, [people]);

	// Filter activity for timeline (only shared + settlements)
	const timelineItems = useMemo(() => {
		if (!recentActivity) return [];
		const shared = recentActivity.filter((a) => a.type === "shared" || a.type === "settlement");
		if (activityFilter === "all") return shared;
		if (activityFilter === "splits") return shared.filter((a) => a.type === "shared");
		return shared.filter((a) => a.type === "settlement");
	}, [recentActivity, activityFilter]);

	// Activity columns for DataTable
	const activityColumns = useMemo(
		() => createActivityColumns(formatCurrency, t),
		[formatCurrency, t],
	);

	// Transform activity items into DataTable rows
	const activityTableRows: ActivityTableRow[] = useMemo(() => {
		return timelineItems.map((item) => {
			if (item.type === "shared" && item.sharedContext) {
				const isMine = item.sharedContext.iPayedThis;
				const personName = isMine ? "Split" : item.sharedContext.paidByName;
				const personAvatarUrl = isMine
					? null
					: (item.sharedContext.paidByAvatarUrl ??
						avatarMap.get(item.sharedContext.paidByName.toLowerCase()) ??
						null);
				const description = isMine
					? t("youSplit", { title: item.title })
					: t("personSplit", { name: item.sharedContext.paidByName, title: item.title });
				const personHref = isMine
					? undefined
					: personHrefMap.get(item.sharedContext.paidByName.toLowerCase());

				return {
					id: item.id,
					type: "shared" as const,
					description,
					personName,
					personAvatarUrl,
					projectName: item.sharedContext.projectName ?? null,
					projectId: item.sharedContext.projectId ?? null,
					date: new Date(item.date),
					amount: item.amount,
					currency: item.currency,
					direction: isMine
						? ("they_owe_you" as const)
						: ("you_owe_them" as const),
					personHref,
				};
			}

			// Settlement
			const ctx = item.settlementContext!;
			const personName = ctx.otherParticipantName;
			const personAvatarUrl =
				avatarMap.get(personName.toLowerCase()) ?? null;
			const personHref = personHrefMap.get(personName.toLowerCase());
			const description =
				ctx.direction === "incoming"
					? t("settledUpWith", { name: personName })
					: t("youSettledUp", { name: personName });

			return {
				id: item.id,
				type: "settlement" as const,
				description,
				personName,
				personAvatarUrl,
				projectName: null,
				projectId: null,
				date: new Date(item.date),
				amount: item.amount,
				currency: item.currency,
				direction: "settlement" as const,
				personHref,
			};
		});
	}, [timelineItems, avatarMap, personHrefMap, t]);

	// Verification banner data
	const visibleQueue = useMemo(
		() => (queue ?? []).filter((item) => !exitingIds.has(item.transaction.id)),
		[queue, exitingIds],
	);
	const visibleQueueCount = visibleQueue.length;

	const bannerSummary = useMemo(() => {
		if (visibleQueue.length === 0) return null;
		const names = [
			...new Set(
				visibleQueue.map(
					(item) =>
						item.transaction.createdByUser?.name ??
						item.transaction.createdByUser?.username ??
						"Unknown",
				),
			),
		];
		const projectIds = [
			...new Set(
				visibleQueue
					.map((item) => item.transaction.projectId)
					.filter(Boolean),
			),
		];

		let fromText: string;
		if (names.length === 1) fromText = t("fromPerson", { name: names[0]! });
		else if (names.length === 2)
			fromText = t("fromTwoPeople", { name1: names[0]!, name2: names[1]! });
		else fromText = t("fromMultiple", { name: names[0]!, count: names.length - 1 });

		if (projectIds.length === 1) {
			const projectItem = visibleQueue.find(
				(item) => item.transaction.projectId === projectIds[0],
			);
			const projectName = projectItem?.transaction.projectName;
			if (projectName) fromText += ` ${t("inProject", { project: projectName })}`;
		} else if (projectIds.length > 1) {
			fromText += ` ${t("acrossProjects", { count: projectIds.length })}`;
		}

		return fromText;
	}, [visibleQueue, t]);

	const displayedItems = bannerExpanded ? visibleQueue.slice(0, BANNER_MAX_ITEMS) : [];
	const remainingCount = visibleQueue.length - displayedItems.length;

	// Compute "View N more in ProjectName" text for overflow link
	const overflowProjectLabel = useMemo(() => {
		if (remainingCount <= 0) return "";
		const projectNames = [
			...new Set(
				visibleQueue
					.slice(BANNER_MAX_ITEMS)
					.map((item) => item.transaction.projectName)
					.filter(Boolean),
			),
		];
		return projectNames.length === 1 ? ` ${t("inProject", { project: projectNames[0]! })}` : "";
	}, [visibleQueue, remainingCount, t]);

	const isLoading = peopleLoading || queueLoading;

	return (
		<>
			<SiteHeader title={t("title")} />
			<PageContent>
				<div className="space-y-6">
					{/* ── Balance Summary Cards ── */}
					{!isLoading && (people?.length ?? 0) > 0 && (
						<div className="grid gap-3 lg:grid-cols-3">
							{/* Hero: Net Balance (dark gradient — the headline metric) */}
							<Card className="relative overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 text-white shadow-xl lg:col-span-1 dark:from-stone-900 dark:via-stone-800 dark:to-black">
								<div className="absolute top-0 right-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full bg-white/5" />
								<div className="absolute bottom-0 left-0 h-24 w-24 -translate-x-8 translate-y-8 rounded-full bg-white/5" />
								<CardContent className="relative flex h-full flex-col justify-between gap-4 p-5">
									<div className="flex items-start justify-between">
										<p className="font-medium text-sm text-white/70">{t("netBalance")}</p>
										<div className="rounded-lg bg-white/10 p-2 backdrop-blur-sm">
											<Scale className="h-4 w-4 text-white/90" />
										</div>
									</div>
									<div className="space-y-1">
										<p
											className={cn(
												"font-bold text-3xl tracking-tight tabular-nums sm:text-4xl",
												stats.net > 0
													? "text-emerald-300"
													: stats.net < 0
														? "text-rose-300"
														: "text-white",
											)}
										>
											{formatCurrency(Math.abs(stats.net), homeCurrency)}
										</p>
										<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-white/70 text-xs">
											<span
												className={cn(
													"inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
													stats.net > 0
														? "bg-emerald-500/20 text-emerald-200"
														: stats.net < 0
															? "bg-rose-500/20 text-rose-200"
															: "bg-white/10 text-white/80",
												)}
											>
												{stats.net > 0
													? t("theyOweYou")
													: stats.net < 0
														? t("youOweThem")
														: t("settled")}
											</span>
											<span>
												{stats.activeCount}{" "}
												{stats.activeCount === 1 ? t("person") : t("personPlural")}
											</span>
										</div>
									</div>
								</CardContent>
							</Card>

							{/* Secondary: Receivable (emerald) + Payable (amber) */}
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
								<Card className="group relative overflow-hidden border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-white transition-all duration-300 hover:shadow-emerald-100 hover:shadow-lg dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-card">
									<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-emerald-500/10 transition-transform duration-300 group-hover:scale-150" />
									<CardContent className="relative flex h-full flex-col justify-between gap-4 p-5">
										<div className="flex items-start justify-between">
											<p className="font-medium text-emerald-700 text-sm dark:text-emerald-400">
												{t("receivable")}
											</p>
											<div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900/50">
												<ArrowDownLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
											</div>
										</div>
										<p className="font-bold text-2xl text-emerald-900 tabular-nums dark:text-emerald-100">
											{formatCurrency(stats.receivable, homeCurrency)}
										</p>
									</CardContent>
								</Card>

								<Card className="group relative overflow-hidden border-amber-200/50 bg-gradient-to-br from-amber-50 to-white transition-all duration-300 hover:shadow-amber-100 hover:shadow-lg dark:border-amber-900/50 dark:from-amber-950/30 dark:to-card">
									<div className="absolute top-0 right-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-amber-500/10 transition-transform duration-300 group-hover:scale-150" />
									<CardContent className="relative flex h-full flex-col justify-between gap-4 p-5">
										<div className="flex items-start justify-between">
											<p className="font-medium text-amber-700 text-sm dark:text-amber-400">
												{t("payable")}
											</p>
											<div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/50">
												<ArrowUpRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
											</div>
										</div>
										<p className="font-bold text-2xl text-amber-900 tabular-nums dark:text-amber-100">
											{formatCurrency(stats.payable, homeCurrency)}
										</p>
									</CardContent>
								</Card>
							</div>
						</div>
					)}

					{/* ── Verification Banner ── */}
					{visibleQueueCount > 0 && (
						<div className="rounded-lg border border-amber-500/20 bg-amber-500/5">
							{/* Summary row */}
							<div className="flex items-center justify-between px-4 py-3">
								<div className="flex items-center gap-3">
									<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
										<AlertCircle className="h-4 w-4 text-amber-500" />
									</div>
									<div>
										<p className="text-sm font-medium">
											{t("expensesNeedReview", { count: visibleQueueCount })}
										</p>
										{bannerSummary && (
											<p className="text-xs text-muted-foreground">{bannerSummary}</p>
										)}
									</div>
								</div>
								<Button
									onClick={() => setBannerExpanded((prev) => !prev)}
									size="sm"
									variant="outline"
								>
									{bannerExpanded ? (
										<>
											{t("collapse")}
											<ChevronUp className="ml-1 h-3 w-3" />
										</>
									) : (
										<>
											{t("reviewNow")}
											<ArrowRight className="ml-1 h-3 w-3" />
										</>
									)}
								</Button>
							</div>

							{/* Expanded items */}
							{bannerExpanded && (
								<div className="border-t border-amber-500/20">
									{displayedItems.map((item) => {
										const creator =
											item.transaction.createdByUser?.name ??
											item.transaction.createdByUser?.username ??
											"Unknown";
										const isActioning = actioningId === item.transaction.id;
										return (
											<div
												className={cn(
													"flex items-center justify-between px-4 py-2.5 transition-all duration-300",
													exitingIds.has(item.transaction.id) &&
														"max-h-0 overflow-hidden opacity-0",
												)}
												key={item.participantId}
											>
												<div className="flex min-w-0 items-center gap-3">
													<UserAvatar
														avatarUrl={item.transaction.createdByUser?.image}
														className="h-6 w-6"
														name={creator}
														size="sm"
													/>
													<div className="flex min-w-0 items-center gap-1">
														<span className="truncate text-sm font-medium">
															{item.transaction.description}
														</span>
														<span className="shrink-0 text-sm text-muted-foreground">
															{formatCurrency(item.shareAmount, item.transaction.currency)}
														</span>
													</div>
													<span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
														{item.transaction.projectName ? `${item.transaction.projectName} · ` : ""}
														{format(new Date(item.transaction.date), "MMM d")}
													</span>
												</div>
												<div className="flex shrink-0 items-center gap-2">
													<Button
														className="h-7 text-xs"
														disabled={isActioning}
														onClick={() => acceptMutation.mutate({ txnId: item.transaction.id })}
														size="sm"
														variant="outline"
													>
														<Check className="mr-1 h-3 w-3" />
														{t("accept")}
													</Button>
													<Button
														className="h-7 text-xs text-muted-foreground"
														disabled={isActioning}
														onClick={() => rejectMutation.mutate({ txnId: item.transaction.id, reason: "" })}
														size="sm"
														variant="ghost"
													>
														<X className="mr-1 h-3 w-3" />
														{t("reject")}
													</Button>
												</div>
											</div>
										);
									})}
									{remainingCount > 0 && (
										<div className="border-t border-amber-500/10 px-4 py-2">
											<button
												className="text-xs font-medium text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300"
												onClick={() => {
													const firstProject = visibleQueue.find((item) => item.transaction.projectId);
													if (firstProject?.transaction.projectId) {
														router.push(`/projects/${firstProject.transaction.projectId}`);
													}
												}}
												type="button"
											>
												{t("viewMore", { count: remainingCount, project: overflowProjectLabel })}
											</button>
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* ── People Section ── */}
					<div className="space-y-3">
						{/* Search + sort controls */}
						{(people?.length ?? 0) >= 2 && (
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
									<TableSearch
										className="sm:w-48"
										onChange={setSearchQuery}
										placeholder={t("searchPlaceholder")}
										value={searchQuery}
										slashFocus
									/>
									<SegmentedToggle
										options={[
											{ value: "balance" as const, label: t("sortBalance") },
											{ value: "name" as const, label: t("sortName") },
											{ value: "recent" as const, label: t("sortRecent") },
										]}
										value={sortBy}
										onChange={setSortBy}
									/>
								</div>
							</div>
						)}

						{/* People grid */}
						{peopleLoading ? (
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
								{/* biome-ignore lint/suspicious/noArrayIndexKey: static skeleton */}
								{[...Array(6)].map((_, i) => (
									<div
										className="rounded-xl border border-border bg-card p-4 shadow-sm"
										key={i}
									>
										<div className="flex items-center gap-3">
											<Skeleton className="h-10 w-10 shrink-0 rounded-full" />
											<div className="flex-1 space-y-1.5">
												<Skeleton className="h-4 w-28" />
												<Skeleton className="h-3 w-20" />
											</div>
										</div>
										<div className="mt-4 space-y-1.5">
											<Skeleton className="h-3 w-16" />
											<Skeleton className="h-6 w-24" />
										</div>
										<Skeleton className="mt-3 h-9 w-full rounded-md" />
									</div>
								))}
							</div>
						) : people && people.length > 0 ? (
							sortedPeople.length === 0 ? (
								<p className="py-8 text-center text-muted-foreground text-sm">
									{t("noMatching", { query: searchQuery })}
								</p>
							) : (
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
									{sortedPeople.map((person) => {
										const direction = getPrimaryDirection(person.balances);
										const isSettled = direction === "settled";
										const href = `/people/${person.identity.participantType}/${person.identity.participantId}`;
										const hct = person.homeCurrencyTotal;

										// Semantic accent by balance direction (design-system colors)
										const accentBar = isSettled
											? "before:bg-transparent"
											: direction === "they_owe_you"
												? "before:bg-emerald-500"
												: "before:bg-amber-500";

										return (
											<div
												className={cn(
													"group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-300",
													"before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
													accentBar,
													isSettled
														? "opacity-70 hover:opacity-100 hover:shadow-md"
														: direction === "they_owe_you"
															? "hover:border-emerald-300/60 hover:shadow-emerald-100 hover:shadow-lg dark:hover:border-emerald-800/60"
															: "hover:border-amber-300/60 hover:shadow-amber-100 hover:shadow-lg dark:hover:border-amber-800/60",
												)}
												key={`${person.identity.participantType}:${person.identity.participantId}`}
												onClick={() => router.push(href)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") router.push(href);
												}}
												role="button"
												tabIndex={0}
											>
												{/* Top row: Avatar + Name */}
												<div className="flex items-center gap-3">
													<div className="relative shrink-0">
														<UserAvatar
															avatarUrl={person.identity.avatarUrl}
															name={person.identity.name}
															size="md"
														/>
														{person.unseenChangesCount > 0 && (
															<span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-amber-500" />
														)}
													</div>
													<div className="min-w-0 flex-1">
														<div className="truncate font-semibold text-sm">
															{person.identity.name}
														</div>
														<div className="truncate text-muted-foreground text-xs">
															{person.identity.username
																? `@${person.identity.username}`
																: person.identity.email ?? null}
														</div>
													</div>
												</div>

												{/* Middle row: Balance */}
												<div className="mt-4">
													<div className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
														{isSettled
															? t("settled")
															: direction === "they_owe_you"
																? t("theyOweYou")
																: t("youOweThem")}
													</div>
													{isSettled ? (
														<span className="font-bold text-muted-foreground text-xl tabular-nums">
															{formatCurrency(0, homeCurrency)}
														</span>
													) : hct && hct.canConvert ? (
														<span
															className={cn(
																"font-bold text-xl tabular-nums",
																hct.amount > 0
																	? "text-emerald-600 dark:text-emerald-400"
																	: "text-amber-600 dark:text-amber-400",
															)}
														>
															{formatCurrency(Math.abs(hct.amount), homeCurrency)}
														</span>
													) : (
														<div className="flex flex-wrap gap-1.5">
															{person.balances.map((b) => (
																<span
																	key={b.currency}
																	className={cn(
																		"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
																		b.direction === "they_owe_you"
																			? "border-emerald-200/60 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30"
																			: "border-amber-200/60 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
																	)}
																>
																	<span
																		className={cn(
																			"font-semibold text-sm leading-none tabular-nums",
																			b.direction === "they_owe_you"
																				? "text-emerald-700 dark:text-emerald-300"
																				: "text-amber-700 dark:text-amber-300",
																		)}
																	>
																		{formatCurrency(b.balance, b.currency)}
																	</span>
																	<span className="text-[10px] text-muted-foreground leading-none">
																		{b.currency}
																	</span>
																</span>
															))}
														</div>
													)}
												</div>

												{/* Settle button — full-width, comfortable touch target */}
												{!isSettled && (
													<Button
														className="mt-3 h-9 w-full justify-center"
														onClick={(e) => {
															e.stopPropagation();
															setSettleTarget({
																participantType: person.identity.participantType as "user" | "guest" | "shadow",
																participantId: person.identity.participantId,
																name: person.identity.name,
																avatarUrl: person.identity.avatarUrl,
															});
														}}
														size="sm"
														variant="outline"
													>
														<Handshake className="h-3.5 w-3.5" />
														{formatSettleLabel(direction as "they_owe_you" | "you_owe_them", hct, homeCurrency, person.balances, formatCurrency, {
															pay: (amount) => t("payAmount", { amount }),
															request: (amount) => t("requestAmount", { amount }),
														})}
													</Button>
												)}

												{/* Bottom row: Last activity */}
												{(person.mostRecentTransactionDescription || person.mostRecentTransactionDate) && (
													<div className="mt-3 border-border/70 border-t pt-3">
														<div className="truncate text-muted-foreground text-xs">
															{person.mostRecentTransactionDescription
																? person.mostRecentTransactionProject
																	? `${t("youSplit", { title: person.mostRecentTransactionDescription })} ${t("inProject", { project: person.mostRecentTransactionProject })} · ${formatDistanceToNow(new Date(person.mostRecentTransactionDate!), { addSuffix: false }).replace("about ", "")}`
																	: `${t("youSplit", { title: person.mostRecentTransactionDescription })} · ${formatDistanceToNow(new Date(person.mostRecentTransactionDate!), { addSuffix: false }).replace("about ", "")}`
																: person.mostRecentTransactionDate
																	? t("lastActive", { time: formatDistanceToNow(new Date(person.mostRecentTransactionDate), { addSuffix: true }) })
																	: null}
														</div>
													</div>
												)}
											</div>
										);
									})}
								</div>
							)
						) : (
							<div className="rounded-xl border border-border border-dashed">
								<EmptyState
									description={t("noSharedDescription")}
									icon={Users}
									title={t("noSharedExpenses")}
								/>
							</div>
						)}
					</div>

					{/* ── Recent Activity Timeline ── */}
					{(people?.length ?? 0) > 0 && (
						<Card className="border border-border bg-card shadow-sm">
							<CardHeader className="px-4 sm:px-6">
								<div className="flex items-center justify-between">
									<CardTitle className="font-semibold text-lg tracking-tight">{t("recentActivity")}</CardTitle>
									<SegmentedToggle
										options={[
											{ value: "all" as const, label: t("filterAll") },
											{ value: "splits" as const, label: t("filterSplits") },
											{ value: "settlements" as const, label: t("filterSettlements") },
										]}
										value={activityFilter}
										onChange={setActivityFilter}
									/>
								</div>
							</CardHeader>
							<CardContent className="px-0 sm:px-0">
								{activityLoading ? (
									<div className="divide-y divide-border px-4 sm:px-6">
										{/* biome-ignore lint/suspicious/noArrayIndexKey: static skeleton */}
										{[...Array(4)].map((_, i) => (
											<div key={i} className="flex items-center gap-3 py-3">
												<Skeleton className="h-8 w-8 shrink-0 rounded-full" />
												<div className="flex-1 space-y-1.5">
													<Skeleton className="h-4 w-48" />
													<Skeleton className="h-3 w-32" />
												</div>
												<Skeleton className="h-4 w-16" />
											</div>
										))}
									</div>
								) : (
									<DataTable
										columns={activityColumns}
										countNoun="items"
										data={activityTableRows}
										emptyState={
											<div className="py-8 text-center text-muted-foreground text-sm">
												{t("noRecentActivity")}
											</div>
										}
										initialSorting={[{ id: "date", desc: true }]}
										onRowClick={(row) => {
											if (row.personHref) router.push(row.personHref);
										}}
										progressive
										searchable={false}
										hideCount
									/>
								)}
							</CardContent>
						</Card>
					)}
				</div>
			</PageContent>

			{settleTarget && (
				<SettleUpDialog
					onClose={() => setSettleTarget(null)}
					open={!!settleTarget}
					participantId={settleTarget.participantId}
					participantType={settleTarget.participantType}
					personAvatarUrl={settleTarget.avatarUrl}
					personName={settleTarget.name}
				/>
			)}
		</>
	);
}

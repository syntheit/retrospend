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
import { StatCard } from "~/components/ui/stat-card";
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

/* ── Segmented toggle (pill-style, matches dashboard filter tabs) ── */

function SegmentedToggle<T extends string>({
	options,
	value,
	onChange,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex gap-1">
			{options.map((opt) => (
				<button
					className={cn(
						"cursor-pointer rounded-full px-3 py-1 font-medium text-xs transition-colors",
						value === opt.value
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
					)}
					key={opt.value}
					onClick={() => onChange(opt.value)}
					type="button"
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

const BANNER_MAX_ITEMS = 3;

type SortOption = "balance" | "name" | "recent";
type ActivityFilter = "all" | "splits" | "settlements";

export default function PeoplePage() {
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
			toast.success("Verified");
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
			toast.success("Rejected");
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
		() => createActivityColumns(formatCurrency),
		[formatCurrency],
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
					? `You split '${item.title}'`
					: `${item.sharedContext.paidByName} split '${item.title}' with you`;
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
					? `${personName} settled up with you`
					: `You settled up with ${personName}`;

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
	}, [timelineItems, avatarMap, personHrefMap]);

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
		if (names.length === 1) fromText = `From ${names[0]}`;
		else if (names.length === 2)
			fromText = `From ${names[0]} and ${names[1]}`;
		else fromText = `From ${names[0]} and ${names.length - 1} others`;

		if (projectIds.length === 1) {
			const projectItem = visibleQueue.find(
				(item) => item.transaction.projectId === projectIds[0],
			);
			const projectName = projectItem?.transaction.projectName;
			if (projectName) fromText += ` in ${projectName}`;
		} else if (projectIds.length > 1) {
			fromText += ` across ${projectIds.length} projects`;
		}

		return fromText;
	}, [visibleQueue]);

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
		return projectNames.length === 1 ? ` in ${projectNames[0]}` : "";
	}, [visibleQueue, remainingCount]);

	const isLoading = peopleLoading || queueLoading;

	return (
		<>
			<SiteHeader title="People" />
			<PageContent>
				<div className="space-y-6">
					{/* ── Stat Cards ── */}
					{!isLoading && (people?.length ?? 0) > 0 && (
						<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
							<StatCard
								description={`${stats.activeCount} ${stats.activeCount === 1 ? "person" : "people"}`}
								icon={Scale}
								title="Net Balance"
								value={formatCurrency(Math.abs(stats.net), homeCurrency)}
								variant={stats.net > 0 ? "emerald" : stats.net < 0 ? "rose" : "neutral"}
							/>
							<StatCard
								icon={ArrowDownLeft}
								title="Receivable"
								value={formatCurrency(stats.receivable, homeCurrency)}
								variant="emerald"
							/>
							<StatCard
								icon={ArrowUpRight}
								title="Payable"
								value={formatCurrency(stats.payable, homeCurrency)}
								variant="rose"
							/>
							<StatCard
								icon={Users}
								title="People"
								value={stats.activeCount}
								variant="neutral"
							/>
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
											{visibleQueueCount} expense{visibleQueueCount !== 1 ? "s" : ""} need{visibleQueueCount === 1 ? "s" : ""} your review
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
											Collapse
											<ChevronUp className="ml-1 h-3 w-3" />
										</>
									) : (
										<>
											Review now
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
														Accept
													</Button>
													<Button
														className="h-7 text-xs text-muted-foreground"
														disabled={isActioning}
														onClick={() => rejectMutation.mutate({ txnId: item.transaction.id, reason: "" })}
														size="sm"
														variant="ghost"
													>
														<X className="mr-1 h-3 w-3" />
														Reject
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
												View {remainingCount} more{overflowProjectLabel} {"\u2192"}
											</button>
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* ── People Section ── */}
					<div className="space-y-3">
						{/* Section header with search + sort */}
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<h2 className="font-semibold text-lg tracking-tight">People</h2>
							{(people?.length ?? 0) >= 2 && (
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
									<TableSearch
										className="sm:w-48"
										onChange={setSearchQuery}
										placeholder="Search people..."
										value={searchQuery}
									/>
									<SegmentedToggle
										options={[
											{ value: "balance" as const, label: "Balance" },
											{ value: "name" as const, label: "Name" },
											{ value: "recent" as const, label: "Recent" },
										]}
										value={sortBy}
										onChange={setSortBy}
									/>
								</div>
							)}
						</div>

						{/* People grid */}
						{peopleLoading ? (
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
								{/* biome-ignore lint/suspicious/noArrayIndexKey: static skeleton */}
								{[...Array(6)].map((_, i) => (
									<div
										className="rounded-lg border border-border bg-card p-4"
										key={i}
									>
										<div className="flex items-center gap-3">
											<Skeleton className="h-10 w-10 shrink-0 rounded-full" />
											<div className="flex-1 space-y-1.5">
												<Skeleton className="h-4 w-28" />
												<Skeleton className="h-3 w-20" />
											</div>
										</div>
										<div className="mt-3 space-y-1">
											<Skeleton className="h-3 w-16" />
											<Skeleton className="h-6 w-24" />
										</div>
									</div>
								))}
							</div>
						) : people && people.length > 0 ? (
							sortedPeople.length === 0 ? (
								<p className="py-8 text-center text-muted-foreground text-sm">
									No people matching &ldquo;{searchQuery}&rdquo;
								</p>
							) : (
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
									{sortedPeople.map((person) => {
										const direction = getPrimaryDirection(person.balances);
										const isSettled = direction === "settled";
										const href = `/people/${person.identity.participantType}/${person.identity.participantId}`;
										const hct = person.homeCurrencyTotal;

										return (
											<div
												className={cn(
													"cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20",
													isSettled && "opacity-60",
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
														<div className="truncate font-medium text-sm">
															{person.identity.name}
														</div>
														<div className="truncate text-xs text-muted-foreground">
															{person.identity.username
																? `@${person.identity.username}`
																: person.identity.email ?? null}
														</div>
													</div>
												</div>

												{/* Middle row: Balance + Settle */}
												<div className="mt-3 flex items-center justify-between">
													<div>
														<div className="text-xs text-muted-foreground">
															{isSettled
																? "Settled"
																: direction === "they_owe_you"
																	? "They owe you"
																	: "You owe them"}
														</div>
														{isSettled ? (
															<span className="text-lg font-semibold tabular-nums text-muted-foreground">
																{formatCurrency(0, homeCurrency)}
															</span>
														) : hct && hct.canConvert ? (
															<span
																className={cn(
																	"text-lg font-semibold tabular-nums",
																	hct.amount > 0
																		? "text-emerald-600 dark:text-emerald-400"
																		: "text-rose-600 dark:text-rose-400",
																)}
															>
																{formatCurrency(Math.abs(hct.amount), homeCurrency)}
															</span>
														) : (
															<div className="flex flex-wrap gap-1.5">
																{person.balances.map((b) => (
																	<span key={b.currency} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/10 px-3 py-1.5">
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
														)}
													</div>
													{!isSettled && (
														<Button
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
															variant="ghost"
														>
															<Handshake className="h-3.5 w-3.5" />
															{formatSettleLabel(direction as "they_owe_you" | "you_owe_them", hct, homeCurrency, person.balances, formatCurrency)}
														</Button>
													)}
												</div>

												{/* Bottom row: Last activity */}
												{(person.mostRecentTransactionDescription || person.mostRecentTransactionDate) && (
													<div className="mt-3 border-t border-border pt-3">
														<div className="truncate text-xs text-muted-foreground">
															{person.mostRecentTransactionDescription
																? person.mostRecentTransactionProject
																	? `Split '${person.mostRecentTransactionDescription}' in ${person.mostRecentTransactionProject} · ${formatDistanceToNow(new Date(person.mostRecentTransactionDate!), { addSuffix: false }).replace("about ", "")}`
																	: `Split '${person.mostRecentTransactionDescription}' · ${formatDistanceToNow(new Date(person.mostRecentTransactionDate!), { addSuffix: false }).replace("about ", "")}`
																: person.mostRecentTransactionDate
																	? `Last active ${formatDistanceToNow(new Date(person.mostRecentTransactionDate), { addSuffix: true })}`
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
									description="Start splitting expenses with someone to see them here."
									icon={Users}
									title="No Shared Expenses Yet"
								/>
							</div>
						)}
					</div>

					{/* ── Recent Activity Timeline ── */}
					{(people?.length ?? 0) > 0 && (
						<Card className="border border-border bg-card shadow-sm">
							<CardHeader className="px-4 sm:px-6">
								<div className="flex items-center justify-between">
									<CardTitle className="font-semibold text-lg tracking-tight">Recent activity</CardTitle>
									<SegmentedToggle
										options={[
											{ value: "all" as const, label: "All" },
											{ value: "splits" as const, label: "Splits" },
											{ value: "settlements" as const, label: "Settlements" },
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
												No recent activity
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

"use client";

import { format } from "date-fns";
import {
	ChevronDown,
	Copy,
	Link2,
	Scale,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CategoryBreakdown } from "~/components/project/category-breakdown";
import { SettleUpDialog } from "~/components/settle-up-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { formatCurrency as formatCurrencyPlain } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type BalancesFromPerspective =
	RouterOutputs["project"]["balancesFromPerspective"];
type Statement = BalancesFromPerspective["statements"][number];

// ── Types ────────────────────────────────────────────────────────────────────

interface Participant {
	id: string;
	participantType: string;
	participantId: string;
	role: string;
	name: string;
	email: string | null;
	username: string | null;
	avatarUrl: string | null;
	joinedAt: Date;
}

interface CategoryStat {
	categoryId: string | null;
	name: string;
	color: string;
	total: number;
	count: number;
}

interface BalancesTabProps {
	projectId: string;
	participants: Participant[];
	currentUserId: string | undefined;
	primaryCurrency: string;
	totalSpent: number;
	categoryStats: CategoryStat[];
}

type ParticipantRefLite = {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
};

/** Which per-person figure the "Who spent what" bars show. */
type SpendMetric = "paid" | "share";

// Number of line items shown before the "View all" toggle.
const INITIAL_ITEMS = 4;

// ── Component ────────────────────────────────────────────────────────────────

export function BalancesTab({
	projectId,
	participants,
	currentUserId,
	primaryCurrency,
	totalSpent,
	categoryStats,
}: BalancesTabProps) {
	const t = useTranslations("projects");

	// Perspective defaults to the current user's participant when present, else
	// the first participant (e.g. the current user is a viewer with no split
	// history — still allow inspecting others' statements).
	const defaultPerspective = useMemo<ParticipantRefLite | null>(() => {
		const mine = participants.find(
			(p) => p.participantType === "user" && p.participantId === currentUserId,
		);
		const chosen = mine ?? participants[0];
		if (!chosen) return null;
		return {
			participantType: chosen.participantType as "user" | "guest" | "shadow",
			participantId: chosen.participantId,
		};
	}, [participants, currentUserId]);

	const [perspective, setPerspective] = useState<ParticipantRefLite | null>(
		defaultPerspective,
	);

	// Keep the chosen perspective valid if the roster changes underneath us.
	const activePerspective = useMemo<ParticipantRefLite | null>(() => {
		if (
			perspective &&
			participants.some(
				(p) =>
					p.participantType === perspective.participantType &&
					p.participantId === perspective.participantId,
			)
		) {
			return perspective;
		}
		return defaultPerspective;
	}, [perspective, participants, defaultPerspective]);

	const perspectiveParticipant = participants.find(
		(p) =>
			activePerspective != null &&
			p.participantType === activePerspective.participantType &&
			p.participantId === activePerspective.participantId,
	);

	const { data, isLoading } = api.project.balancesFromPerspective.useQuery(
		{
			projectId,
			perspective: activePerspective!,
		},
		{ enabled: activePerspective != null },
	);

	// Settle-up section starts open when there is a balance worth acting on and
	// there is more than one person; single-person / all-settled projects lead
	// with a collapsed section so the read-only overview is the whole story.
	const hasStatements = (data?.statements.length ?? 0) > 0;
	const [settleOpen, setSettleOpen] = useState(true);

	return (
		<div className="max-h-[calc(100dvh-14rem)] space-y-6 overflow-y-auto">
			{/* ── Spending overview (read-only) ── */}
			<SpendingOverview
				categoryStats={categoryStats}
				currentUserId={currentUserId}
				participants={participants}
				primaryCurrency={primaryCurrency}
				projectId={projectId}
				totalSpent={totalSpent}
			/>

			{/* ── Divider into the actionable settle-up view ── */}
			<Collapsible onOpenChange={setSettleOpen} open={settleOpen}>
				<CollapsibleTrigger className="group flex w-full items-center gap-3 border-border border-t pt-5 text-left">
					<span className="font-semibold text-sm uppercase tracking-wide">
						{t("settleUpDivider")}
					</span>
					<span className="h-px flex-1 bg-border" />
					<ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
				</CollapsibleTrigger>
				<CollapsibleContent className="space-y-4 pt-4">
					{/* Perspective switcher */}
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground text-sm">
							{t("viewingAs")}
						</span>
						<PerspectiveSwitcher
							current={perspectiveParticipant}
							currentUserId={currentUserId}
							onSelect={(p) =>
								setPerspective({
									participantType: p.participantType as
										| "user"
										| "guest"
										| "shadow",
									participantId: p.participantId,
								})
							}
							participants={participants}
						/>
					</div>

					{isLoading ? (
						<div className="space-y-3">
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-40 w-full" />
							<Skeleton className="h-40 w-full" />
						</div>
					) : !data || !hasStatements ? (
						<EmptyState
							name={
								data?.perspective.name ?? perspectiveParticipant?.name ?? ""
							}
						/>
					) : (
						<>
							<SummaryCard totals={data.totals} />
							<div className="space-y-3">
								{data.statements.map((s) => (
									<StatementCard
										key={`${s.counterpart.participantType}:${s.counterpart.participantId}`}
										perspectiveName={data.perspective.name}
										perspectiveIsCurrentUser={
											activePerspective?.participantType === "user" &&
											activePerspective.participantId === currentUserId
										}
										projectId={projectId}
										statement={s}
									/>
								))}
							</div>
						</>
					)}
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

// ── Spending overview (total + who-spent-what + category breakdown) ──────────

function SpendingOverview({
	projectId,
	participants,
	currentUserId,
	primaryCurrency,
	totalSpent,
	categoryStats,
}: {
	projectId: string;
	participants: Participant[];
	currentUserId: string | undefined;
	primaryCurrency: string;
	totalSpent: number;
	categoryStats: CategoryStat[];
}) {
	const t = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();
	const [metric, setMetric] = useState<SpendMetric>("paid");

	const isMultiPerson = participants.length > 1;
	const { data: balancesData } = api.project.participantBalances.useQuery(
		{ projectId },
		{ enabled: isMultiPerson },
	);

	// Per-person paid/share for the primary currency only (v1). Other currencies
	// are surfaced as a note rather than silently folded into the primary total.
	const { rows, hasOtherCurrencies } = useMemo(() => {
		const byKey = new Map<string, { paid: number; share: number }>();
		let otherCurrencies = false;
		for (const b of balancesData?.balances ?? []) {
			if (b.currency !== primaryCurrency) {
				otherCurrencies = true;
				continue;
			}
			const key = `${b.participant.participantType}:${b.participant.participantId}`;
			byKey.set(key, { paid: b.totalPaid, share: b.fairShare });
		}

		const built = participants.map((p) => {
			const key = `${p.participantType}:${p.participantId}`;
			const figures = byKey.get(key) ?? { paid: 0, share: 0 };
			return {
				participant: p,
				isMe:
					p.participantType === "user" && p.participantId === currentUserId,
				paid: figures.paid,
				share: figures.share,
			};
		});

		return { rows: built, hasOtherCurrencies: otherCurrencies };
	}, [balancesData, participants, primaryCurrency, currentUserId]);

	const metricTotal = useMemo(
		() => rows.reduce((sum, r) => sum + Math.max(0, r[metric]), 0),
		[rows, metric],
	);

	const sortedRows = useMemo(
		() => [...rows].sort((a, b) => b[metric] - a[metric]),
		[rows, metric],
	);

	const expenseCount = categoryStats.reduce((sum, s) => sum + s.count, 0);
	const avgShare =
		participants.length > 0 ? totalSpent / participants.length : 0;

	return (
		<div className="space-y-4">
			{/* Total spent hero */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="space-y-1">
					<p className="text-muted-foreground text-xs uppercase tracking-wide">
						{t("totalSpent")}
					</p>
					<p className="font-bold text-3xl tabular-nums tracking-tight sm:text-4xl">
						{formatCurrency(totalSpent, primaryCurrency)}
					</p>
					<p className="text-muted-foreground text-xs">
						{t("totalSpentMeta", { count: expenseCount })}
					</p>
				</div>
				{isMultiPerson && (
					<div className="flex gap-6 text-sm">
						<div className="space-y-0.5">
							<p className="font-semibold text-lg tabular-nums">
								{participants.length}
							</p>
							<p className="text-muted-foreground text-xs">
								{t("peopleCount", { count: participants.length })}
							</p>
						</div>
						<div className="space-y-0.5">
							<p className="font-semibold text-lg tabular-nums">
								{formatCurrency(avgShare, primaryCurrency)}
							</p>
							<p className="text-muted-foreground text-xs">
								{t("avgSharePerPerson")}
							</p>
						</div>
					</div>
				)}
			</div>

			{/* Who spent what */}
			{isMultiPerson && (
				<Card>
					<CardContent className="space-y-3 py-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="font-semibold text-sm">{t("whoSpentWhat")}</h3>
							<SegmentedToggle<SpendMetric>
								onChange={setMetric}
								options={[
									{ value: "paid", label: t("paid") },
									{ value: "share", label: t("share") },
								]}
								value={metric}
							/>
						</div>
						<p className="text-muted-foreground text-xs">
							{metric === "paid" ? t("paidHint") : t("shareHint")}
						</p>
						<div className="space-y-2.5">
							{sortedRows.map((row) => (
								<SpendRow
									amount={row[metric]}
									formatCurrency={formatCurrency}
									isMe={row.isMe}
									key={row.participant.id}
									participant={row.participant}
									primaryCurrency={primaryCurrency}
									total={metricTotal}
								/>
							))}
						</div>
						{hasOtherCurrencies && (
							<p className="text-muted-foreground text-xs">
								{t("spendingInOtherCurrencies")}
							</p>
						)}
					</CardContent>
				</Card>
			)}

			{/* Category breakdown */}
			<CategoryBreakdown
				categories={categoryStats}
				currency={primaryCurrency}
				totalSpent={totalSpent}
			/>
		</div>
	);
}

function SpendRow({
	participant,
	isMe,
	amount,
	total,
	primaryCurrency,
	formatCurrency,
}: {
	participant: Participant;
	isMe: boolean;
	amount: number;
	total: number;
	primaryCurrency: string;
	formatCurrency: (amount: number, currency: string) => string;
}) {
	const t = useTranslations("projects");
	const pct = total > 0 ? (Math.max(0, amount) / total) * 100 : 0;

	return (
		<div className="flex items-center gap-3">
			<PersonAvatar participant={participant} size="sm" />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					<span className="truncate font-medium text-sm">
						{participant.name}
						{isMe && (
							<span className="ml-1 font-normal text-muted-foreground">
								({t("you")})
							</span>
						)}
					</span>
					<span className="flex shrink-0 items-baseline gap-2 tabular-nums">
						<span className="font-medium text-sm">
							{formatCurrency(amount, primaryCurrency)}
						</span>
						<span className="text-muted-foreground text-xs">
							{pct.toFixed(pct < 10 ? 1 : 0)}%
						</span>
					</span>
				</div>
				<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
					<span
						className="block h-full rounded-full bg-primary transition-[width]"
						style={{ width: `${Math.min(100, pct)}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

// ── Perspective switcher ──────────────────────────────────────────────────────

function PerspectiveSwitcher({
	current,
	participants,
	currentUserId,
	onSelect,
}: {
	current: Participant | undefined;
	participants: Participant[];
	currentUserId: string | undefined;
	onSelect: (p: Participant) => void;
}) {
	const t = useTranslations("projects");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className="h-auto gap-2 px-2 py-1.5" size="sm" variant="outline">
					{current ? (
						<span className="flex items-center gap-2">
							<PersonAvatar participant={current} size="xs" />
							<span className="font-medium text-sm">{current.name}</span>
						</span>
					) : (
						<span className="text-sm">{t("selectPerson")}</span>
					)}
					<ChevronDown className="h-3.5 w-3.5 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				{participants.map((p) => {
					const isMe =
						p.participantType === "user" && p.participantId === currentUserId;
					return (
						<DropdownMenuItem
							className="gap-2"
							key={p.id}
							onClick={() => onSelect(p)}
						>
							<PersonAvatar participant={p} size="xs" />
							<div className="flex min-w-0 flex-col leading-tight">
								<span className="truncate font-medium text-sm">
									{p.name}
									{isMe && (
										<span className="ml-1 font-normal text-muted-foreground">
											({t("you")})
										</span>
									)}
								</span>
								<PersonSublineText participant={p} />
							</div>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ── Summary ────────────────────────────────────────────────────────────────

function SummaryCard({
	totals,
}: {
	totals: {
		owedToPerspective: Record<string, number>;
		owedByPerspective: Record<string, number>;
	};
}) {
	const t = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();

	const owedTo = Object.entries(totals.owedToPerspective);
	const owedBy = Object.entries(totals.owedByPerspective);

	if (owedTo.length === 0 && owedBy.length === 0) {
		return null;
	}

	return (
		<Card>
			<CardContent className="grid gap-4 py-4 sm:grid-cols-2">
				<div className="space-y-1">
					<p className="text-muted-foreground text-xs uppercase tracking-wide">
						{t("totalOwedToYou")}
					</p>
					{owedTo.length > 0 ? (
						<div className="flex flex-col gap-0.5">
							{owedTo.map(([currency, amount]) => (
								<span
									className="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400"
									key={currency}
								>
									{formatCurrency(amount, currency)}
								</span>
							))}
						</div>
					) : (
						<span className="text-muted-foreground text-sm">
							{t("nothingOwed")}
						</span>
					)}
				</div>
				<div className="space-y-1 sm:border-l sm:border-border sm:pl-4">
					<p className="text-muted-foreground text-xs uppercase tracking-wide">
						{t("totalYouOwe")}
					</p>
					{owedBy.length > 0 ? (
						<div className="flex flex-col gap-0.5">
							{owedBy.map(([currency, amount]) => (
								<span
									className="font-semibold text-amber-600 tabular-nums dark:text-amber-400"
									key={currency}
								>
									{formatCurrency(amount, currency)}
								</span>
							))}
						</div>
					) : (
						<span className="text-muted-foreground text-sm">
							{t("nothingOwed")}
						</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

// ── Statement card ────────────────────────────────────────────────────────

function StatementCard({
	statement,
	perspectiveName,
	perspectiveIsCurrentUser,
	projectId,
}: {
	statement: Statement;
	perspectiveName: string;
	perspectiveIsCurrentUser: boolean;
	projectId: string;
}) {
	const t = useTranslations("projects");
	const { formatCurrency } = useCurrencyFormatter();
	const [showAll, setShowAll] = useState(false);
	const [settleOpen, setSettleOpen] = useState(false);

	const counterpart = statement.counterpart;
	const net = Object.entries(statement.netByCurrency);

	const visibleItems = showAll
		? statement.itemized
		: statement.itemized.slice(0, INITIAL_ITEMS);
	const hiddenCount = statement.itemized.length - visibleItems.length;

	const handleCopy = async () => {
		const text = buildStatementText({
			statement,
			perspectiveName,
			perspectiveIsCurrentUser,
			t,
		});
		try {
			await navigator.clipboard.writeText(text);
			toast.success(t("statementCopied"));
		} catch {
			toast.error(t("copyFailed"));
		}
	};

	return (
		<Card>
			<CardContent className="space-y-4 py-4">
				{/* Header: counterpart + net */}
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<PersonAvatar
							participant={counterpartToParticipant(counterpart)}
							size="sm"
						/>
						<div className="flex min-w-0 flex-col leading-tight">
							<span className="truncate font-medium">{counterpart.name}</span>
							<CounterpartSubline counterpart={counterpart} />
						</div>
					</div>
				</div>

				{/* Net per currency, directional + plain-worded */}
				<div className="space-y-0.5">
					{net.length === 0 ? (
						<span className="text-muted-foreground text-sm">
							{t("allSettledShort")}
						</span>
					) : (
						net.map(([currency, value]) => (
							<NetLine
								amountText={formatCurrency(Math.abs(value), currency)}
								counterpartName={counterpart.name}
								key={currency}
								perspectiveIsCurrentUser={perspectiveIsCurrentUser}
								perspectiveName={perspectiveName}
								value={value}
							/>
						))
					)}
				</div>

				{/* Itemized line items */}
				{statement.itemized.length > 0 && (
					<div className="rounded-lg border border-border">
						<div className="divide-y divide-border/60">
							{visibleItems.map((item) => (
								<LineItemRow
									formatCurrency={formatCurrency}
									item={item}
									key={item.id}
									perspectiveName={perspectiveName}
								/>
							))}
						</div>
						{hiddenCount > 0 && (
							<button
								className="w-full cursor-pointer rounded-b-lg border-border border-t bg-muted/30 px-3 py-2 text-center text-muted-foreground text-xs transition-colors hover:bg-muted/60"
								onClick={() => setShowAll(true)}
								type="button"
							>
								{t("viewAllItems", { count: hiddenCount })}
							</button>
						)}
						{showAll && statement.itemized.length > INITIAL_ITEMS && (
							<button
								className="w-full cursor-pointer rounded-b-lg border-border border-t bg-muted/30 px-3 py-2 text-center text-muted-foreground text-xs transition-colors hover:bg-muted/60"
								onClick={() => setShowAll(false)}
								type="button"
							>
								{t("showLess")}
							</button>
						)}
					</div>
				)}

				{/* Actions */}
				<div className="flex flex-wrap gap-2">
					{perspectiveIsCurrentUser && net.length > 0 && (
						<Button onClick={() => setSettleOpen(true)} size="sm">
							{t("settleUp")}
						</Button>
					)}
					<Button
						className="gap-1"
						onClick={handleCopy}
						size="sm"
						variant="outline"
					>
						<Copy className="h-3.5 w-3.5" />
						{t("copyStatement")}
					</Button>
				</div>
			</CardContent>

			{/* Settle up reuses the existing settlement flow (current-user only). */}
			{perspectiveIsCurrentUser && (
				<SettleUpDialog
					onClose={() => setSettleOpen(false)}
					open={settleOpen}
					participantId={counterpart.participantId}
					participantType={counterpart.participantType}
					personAvatarUrl={counterpart.avatarUrl}
					personName={counterpart.name}
					projectId={projectId}
				/>
			)}
		</Card>
	);
}

function NetLine({
	value,
	counterpartName,
	perspectiveName,
	perspectiveIsCurrentUser,
	amountText,
}: {
	value: number;
	counterpartName: string;
	perspectiveName: string;
	perspectiveIsCurrentUser: boolean;
	amountText: string;
}) {
	const t = useTranslations("projects");
	// Positive => counterpart owes the perspective person. Negative => perspective
	// owes the counterpart. Always word it, never color alone.
	if (value > 0) {
		return (
			<p className="font-medium text-emerald-600 text-sm dark:text-emerald-400">
				{perspectiveIsCurrentUser
					? t("counterpartOwesYou", {
							name: counterpartName,
							amount: amountText,
						})
					: t("counterpartOwesPerson", {
							name: counterpartName,
							person: perspectiveName,
							amount: amountText,
						})}
			</p>
		);
	}
	return (
		<p className="font-medium text-amber-600 text-sm dark:text-amber-400">
			{perspectiveIsCurrentUser
				? t("youOweCounterpart", {
						name: counterpartName,
						amount: amountText,
					})
				: t("personOwesCounterpart", {
						person: perspectiveName,
						name: counterpartName,
						amount: amountText,
					})}
		</p>
	);
}

function LineItemRow({
	item,
	perspectiveName,
	formatCurrency,
}: {
	item: Statement["itemized"][number];
	perspectiveName: string;
	formatCurrency: (amount: number, currency: string) => string;
}) {
	const t = useTranslations("projects");
	const paidByLabel = item.paidBy.isPerspective
		? t("paidByYouLabel", { name: perspectiveName })
		: item.paidBy.name;

	return (
		<div className="flex items-start justify-between gap-3 px-3 py-2">
			<div className="flex min-w-0 flex-col leading-tight">
				<span className="truncate font-medium text-sm">{item.description}</span>
				<span className="text-muted-foreground text-xs">
					{format(new Date(item.date), "MMM d, yyyy")} ·{" "}
					{t("paidByShort", { name: paidByLabel })}
				</span>
			</div>
			<div className="flex shrink-0 flex-col items-end leading-tight">
				<span className="text-muted-foreground text-xs tabular-nums">
					{formatCurrency(item.amount, item.currency)}
				</span>
				<span className="font-medium text-sm tabular-nums">
					{t("shareLabel", {
						amount: formatCurrency(item.counterpartShare, item.currency),
					})}
				</span>
			</div>
		</div>
	);
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ name }: { name: string }) {
	const t = useTranslations("projects");
	return (
		<Card>
			<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
				<Scale className="h-8 w-8 text-muted-foreground" />
				<p className="font-medium text-sm">{t("noBalancesTitle")}</p>
				<p className="max-w-sm text-muted-foreground text-sm">
					{name
						? t("noBalancesForPerson", { name })
						: t("noBalancesDescription")}
				</p>
			</CardContent>
		</Card>
	);
}

// ── Shared person rendering (mirrors People tab) ─────────────────────────────

type PersonLike = {
	participantType: string;
	name: string;
	avatarUrl: string | null;
};

function PersonAvatar({
	participant,
	size = "sm",
}: {
	participant: PersonLike;
	size?: "xs" | "sm" | "md";
}) {
	if (participant.participantType === "shadow") {
		return (
			<div className="relative">
				<UserAvatar name={participant.name} size={size} />
				<Link2 className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full bg-background text-muted-foreground" />
			</div>
		);
	}
	return (
		<UserAvatar
			avatarUrl={participant.avatarUrl}
			name={participant.name}
			size={size}
		/>
	);
}

function PersonSublineText({ participant }: { participant: Participant }) {
	const t = useTranslations("projects");
	if (participant.participantType === "shadow") {
		return (
			<span className="truncate text-muted-foreground text-xs">
				{participant.email ?? t("shadowProfileNoAccount")}
			</span>
		);
	}
	if (participant.participantType === "guest") {
		return (
			<span className="truncate text-muted-foreground text-xs">
				{participant.email ? `${participant.email} · ` : ""}
				{t("guestViaInviteLink")}
			</span>
		);
	}
	if (participant.username) {
		return (
			<span className="truncate text-muted-foreground text-xs">
				@{participant.username}
			</span>
		);
	}
	return null;
}

function CounterpartSubline({
	counterpart,
}: {
	counterpart: Statement["counterpart"];
}) {
	const t = useTranslations("projects");
	if (counterpart.participantType === "shadow") {
		return (
			<span className="truncate text-muted-foreground text-xs">
				{counterpart.email ?? t("shadowProfileNoAccount")}
			</span>
		);
	}
	if (counterpart.participantType === "guest") {
		return (
			<span className="truncate text-muted-foreground text-xs">
				{counterpart.email ? `${counterpart.email} · ` : ""}
				{t("guestViaInviteLink")}
			</span>
		);
	}
	if (counterpart.username) {
		return (
			<span className="truncate text-muted-foreground text-xs">
				@{counterpart.username}
			</span>
		);
	}
	return null;
}

function counterpartToParticipant(c: Statement["counterpart"]): PersonLike {
	return {
		participantType: c.participantType,
		name: c.name,
		avatarUrl: c.avatarUrl,
	};
}

// ── Copy-to-clipboard statement text ─────────────────────────────────────────

function buildStatementText({
	statement,
	perspectiveName,
	perspectiveIsCurrentUser,
	t,
}: {
	statement: Statement;
	perspectiveName: string;
	perspectiveIsCurrentUser: boolean;
	t: ReturnType<typeof useTranslations>;
}): string {
	const counterpartName = statement.counterpart.name;
	const net = Object.entries(statement.netByCurrency);

	// Plain formatting for the copied text: standard symbol style, no smart
	// abbreviation, so the pasted number is exact and unambiguous.
	const fmt = (amount: number, currency: string) =>
		formatCurrencyPlain(amount, currency, "standard", false);

	const lines: string[] = [];

	for (const [currency, value] of net) {
		const amountText = fmt(Math.abs(value), currency);
		// Only itemize expenses in this currency that move the balance the same way.
		const items = statement.itemized.filter(
			(it) => it.currency === currency && Math.sign(it.signedAmount) === Math.sign(value),
		);
		const itemsText = items
			.map(
				(it) =>
					`${it.description} ${fmt(it.counterpartShare, it.currency)}`,
			)
			.join(", ");

		let headline: string;
		if (value > 0) {
			headline = perspectiveIsCurrentUser
				? t("copyLineTheyOweYou", { name: counterpartName, amount: amountText })
				: t("copyLineTheyOwePerson", {
						name: counterpartName,
						person: perspectiveName,
						amount: amountText,
					});
		} else {
			headline = perspectiveIsCurrentUser
				? t("copyLineYouOwe", { name: counterpartName, amount: amountText })
				: t("copyLinePersonOwes", {
						person: perspectiveName,
						name: counterpartName,
						amount: amountText,
					});
		}

		lines.push(itemsText ? `${headline} ${t("copyForColon")} ${itemsText}` : headline);
	}

	if (lines.length === 0) {
		return t("copyAllSettled", {
			name: counterpartName,
			person: perspectiveIsCurrentUser ? "" : perspectiveName,
		}).trim();
	}

	return lines.join("\n");
}

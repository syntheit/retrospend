"use client";

import { type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { DataTable } from "~/components/data-table";
import { MonthStepper } from "~/components/date/MonthStepper";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";

interface AiUsageRow {
	id: string;
	username: string;
	localTokensUsed: number;
	externalTokensUsed: number;
	tokensUsed: number;
	localPct: number;
	extPct: number;
}

function dateToYearMonth(date: Date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const columns: ColumnDef<AiUsageRow>[] = [
	{
		accessorKey: "username",
		header: "Username",
		cell: ({ row }) => (
			<span className="font-medium">@{row.original.username}</span>
		),
	},
	{
		accessorKey: "localTokensUsed",
		header: "Local",
		cell: ({ row }) => {
			const { localTokensUsed, localPct } = row.original;
			return (
				<div className="text-right">
					{localTokensUsed > 0 ? (
						<span className="inline-flex items-center gap-1.5">
							{localTokensUsed.toLocaleString()}
							<Badge className="tabular-nums text-[10px]" variant="outline">
								{localPct}%
							</Badge>
						</span>
					) : (
						<span className="text-muted-foreground">-</span>
					)}
				</div>
			);
		},
	},
	{
		accessorKey: "externalTokensUsed",
		header: "External",
		cell: ({ row }) => {
			const { externalTokensUsed, extPct } = row.original;
			return (
				<div className="text-right">
					{externalTokensUsed > 0 ? (
						<span className="inline-flex items-center gap-1.5">
							{externalTokensUsed.toLocaleString()}
							<Badge
								className={`tabular-nums text-[10px] ${extPct >= 100 ? "border-destructive text-destructive" : ""}`}
								variant="outline"
							>
								{extPct}%
							</Badge>
						</span>
					) : (
						<span className="text-muted-foreground">-</span>
					)}
				</div>
			);
		},
	},
	{
		accessorKey: "tokensUsed",
		header: "Total",
		cell: ({ row }) => (
			<div className="text-right">
				{row.original.tokensUsed.toLocaleString()}
			</div>
		),
	},
	{
		id: "quota",
		header: "Quota",
		enableSorting: false,
		cell: ({ row }) => {
			const { extPct, externalTokensUsed, localPct, localTokensUsed } =
				row.original;
			return (
				<div className="text-right">
					{externalTokensUsed > 0 && extPct >= 100 ? (
						<span className="font-medium text-destructive text-xs">
							External limit reached
						</span>
					) : localTokensUsed > 0 && localPct >= 100 ? (
						<span className="font-medium text-xs text-yellow-600 dark:text-yellow-500">
							Local limit reached
						</span>
					) : null}
				</div>
			);
		},
	},
];

export function AiUsageTable() {
	const [month, setMonth] = useState(() => new Date());
	const selectedMonth = dateToYearMonth(month);
	const isMobile = useIsMobile();

	const handleMonthChange = useCallback((date: Date) => {
		setMonth(date);
	}, []);

	const { data, isLoading } = api.admin.getAiUsageStats.useQuery(
		{ yearMonth: selectedMonth },
		{ enabled: !!selectedMonth },
	);

	const totalLocal =
		data?.usages.reduce((sum, u) => sum + u.localTokensUsed, 0) ?? 0;
	const totalExternal =
		data?.usages.reduce((sum, u) => sum + u.externalTokensUsed, 0) ?? 0;

	const rows: AiUsageRow[] = useMemo(() => {
		if (!data?.usages) return [];
		return data.usages.map((u) => ({
			id: u.userId,
			username: u.username,
			localTokensUsed: u.localTokensUsed,
			externalTokensUsed: u.externalTokensUsed,
			tokensUsed: u.tokensUsed,
			localPct: data.localQuota
				? Math.round((u.localTokensUsed / data.localQuota) * 100)
				: 0,
			extPct: data.externalQuota
				? Math.round((u.externalTokensUsed / data.externalQuota) * 100)
				: 0,
		}));
	}, [data]);

	const columnVisibility: VisibilityState = isMobile
		? { localTokensUsed: false, externalTokensUsed: false }
		: {};

	const emptyState = isLoading ? (
		<div className="py-8 text-muted-foreground text-sm">Loading...</div>
	) : (
		<div className="py-8 text-muted-foreground text-sm">
			No AI usage this month
		</div>
	);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="space-y-1">
					<p className="text-muted-foreground text-sm">
						<span className="text-muted-foreground/70">Local:</span>{" "}
						{totalLocal.toLocaleString()}
						{data?.localQuota
							? ` / ${data.localQuota.toLocaleString()} per user`
							: ""}
						{" · "}
						<span className="text-muted-foreground/70">External:</span>{" "}
						{totalExternal.toLocaleString()}
						{data?.externalQuota
							? ` / ${data.externalQuota.toLocaleString()} per user`
							: ""}
					</p>
				</div>
				<MonthStepper onChange={handleMonthChange} value={month} />
			</div>

			<DataTable<AiUsageRow>
				columns={columns}
				columnVisibility={columnVisibility}
				countNoun="users"
				data={rows}
				emptyState={emptyState}
				searchable={false}
			/>
		</div>
	);
}

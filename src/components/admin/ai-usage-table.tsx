"use client";

import { useState } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";

function getMonthOptions() {
	const options: { value: string; label: string }[] = [];
	const now = new Date();
	for (let i = 0; i < 6; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
		const label = d.toLocaleDateString("en-US", {
			year: "numeric",
			month: "long",
		});
		options.push({ value, label });
	}
	return options;
}

export function AiUsageTable() {
	const monthOptions = getMonthOptions();
	const [selectedMonth, setSelectedMonth] = useState(
		monthOptions[0]?.value ?? "",
	);

	const { data, isLoading } = api.admin.getAiUsageStats.useQuery(
		{ yearMonth: selectedMonth },
		{ enabled: !!selectedMonth },
	);

	const totalTokens =
		data?.usages.reduce((sum, u) => sum + u.tokensUsed, 0) ?? 0;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<p className="text-muted-foreground text-sm">
						Total: {totalTokens.toLocaleString()} tokens
						{data?.quota
							? ` (quota: ${data.quota.toLocaleString()} per user)`
							: ""}
					</p>
				</div>
				<Select onValueChange={setSelectedMonth} value={selectedMonth}>
					<SelectTrigger className="w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{monthOptions.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Username</TableHead>
							<TableHead className="text-right">Tokens Used</TableHead>
							<TableHead className="text-right">Quota %</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell className="text-muted-foreground text-center" colSpan={3}>
									Loading...
								</TableCell>
							</TableRow>
						) : !data?.usages.length ? (
							<TableRow>
								<TableCell className="text-muted-foreground text-center" colSpan={3}>
									No AI usage this month
								</TableCell>
							</TableRow>
						) : (
							data.usages.map((u) => {
								const pct = data.quota
									? Math.round((u.tokensUsed / data.quota) * 100)
									: 0;
								return (
									<TableRow key={u.userId}>
										<TableCell className="font-medium">
											@{u.username}
										</TableCell>
										<TableCell className="text-right">
											{u.tokensUsed.toLocaleString()}
										</TableCell>
										<TableCell className="text-right">
											<span
												className={pct >= 100 ? "text-destructive font-medium" : ""}
											>
												{pct}%
											</span>
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

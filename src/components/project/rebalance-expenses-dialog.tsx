"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { api } from "~/trpc/react";

interface RebalanceExpensesDialogProps {
	projectId: string;
	participant: {
		participantType: "user" | "guest" | "shadow";
		participantId: string;
		name: string;
	} | null;
	onOpenChange: (open: boolean) => void;
}

/**
 * Prompts the organizer to fold a newly-added participant into a project's
 * existing expenses. Opens directly to a checklist of every eligible past
 * expense: the genuine "split with everyone" ones (all other current members
 * already included) are pre-checked, single-person or partial splits are left
 * unchecked but visible. The organizer confirms the selection or picks
 * "Future only" to leave the past untouched. Only EQUAL-mode, unlocked expenses
 * are eligible for automatic rebalancing.
 */
export function RebalanceExpensesDialog({
	projectId,
	participant,
	onOpenChange,
}: RebalanceExpensesDialogProps) {
	const t = useTranslations("projects");
	const utils = api.useUtils();
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const open = participant !== null;

	const { data: expenses, isLoading } =
		api.project.rebalanceableExpenses.useQuery(
			{
				projectId,
				participantType: participant?.participantType ?? "user",
				participantId: participant?.participantId ?? "",
			},
			{ enabled: open },
		);

	const eligible = useMemo(
		() => (expenses ?? []).filter((e) => e.eligible),
		[expenses],
	);
	// Ineligible = present but not EQUAL-split (EXACT / PERCENTAGE / SHARES).
	// Locked expenses are already excluded server-side, so these are purely the
	// exact/percentage/share splits we can't recompute automatically.
	const ineligible = useMemo(
		() => (expenses ?? []).filter((e) => !e.eligible),
		[expenses],
	);
	const total = (expenses ?? []).length;

	// Pre-check the genuine "split with everyone" expenses once results land.
	// Partial / single-person splits stay unchecked but visible so the organizer
	// can opt them in deliberately.
	useEffect(() => {
		if (!expenses) return;
		setSelected(
			new Set(
				eligible.filter((e) => e.hasAllOtherMembers).map((e) => e.id),
			),
		);
	}, [expenses, eligible]);

	const rebalanceMutation = api.project.rebalanceExpenses.useMutation({
		onSuccess: async (res) => {
			if (res.rebalancedCount > 0) {
				toast.success(
					t("rebalanceApplied", { count: res.rebalancedCount }),
				);
			}
			await Promise.all([
				utils.project.detail.invalidate({ id: projectId }),
				utils.project.listExpenses.invalidate({ projectId }),
			]);
			close();
		},
		onError: (e) => toast.error(e.message),
	});

	const close = () => {
		setSelected(new Set());
		onOpenChange(false);
	};

	const runRebalance = (expenseIds: string[]) => {
		if (!participant) return;
		rebalanceMutation.mutate({
			projectId,
			participantType: participant.participantType,
			participantId: participant.participantId,
			expenseIds,
		});
	};

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	// Nothing to rebalance: don't nag with an empty dialog.
	const showEmpty = open && !isLoading && eligible.length === 0;

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={(o) => {
				if (!o) close();
			}}
		>
			<ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-0 p-0">
				<ResponsiveDialogHeader className="px-6 pt-6 pb-3">
					<ResponsiveDialogTitle>
						{t("includeInExpensesTitle", {
							name: participant?.name ?? "",
						})}
					</ResponsiveDialogTitle>
					<ResponsiveDialogDescription>
						{showEmpty
							? t("includeInExpensesNone")
							: t("includeInExpensesDescription", {
									name: participant?.name ?? "",
								})}
					</ResponsiveDialogDescription>
				</ResponsiveDialogHeader>

				{isLoading ? (
					<div className="px-6 py-8 text-center text-muted-foreground text-sm">
						{t("searching")}
					</div>
				) : showEmpty ? (
					<div className="flex justify-end px-6 pt-2 pb-6">
						<Button type="button" onClick={close}>
							{t("done")}
						</Button>
					</div>
				) : (
					<>
						{/* What "eligible" means, plus how many of the past expenses
						    actually qualify for automatic rebalancing. */}
						<div className="space-y-1 px-6 pb-2 text-muted-foreground text-sm">
							<p className="font-medium text-foreground">
								{t("rebalanceQualifyCount", {
									count: eligible.length,
									total,
								})}
							</p>
							{ineligible.length > 0 && (
								<p>
									{t("rebalanceIneligibleCount", {
										count: ineligible.length,
									})}
								</p>
							)}
						</div>

						{/* Checklist of every eligible past expense. Genuine
						    "split with everyone" ones arrive pre-checked. */}
						<div className="flex-1 overflow-y-auto px-3 py-1">
							{eligible.map((e) => (
								<div
									key={e.id}
									role="button"
									tabIndex={0}
									onClick={() => toggle(e.id)}
									onKeyDown={(ev) => {
										if (ev.key === "Enter" || ev.key === " ") {
											ev.preventDefault();
											toggle(e.id);
										}
									}}
									className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
								>
									<Checkbox
										checked={selected.has(e.id)}
										className="pointer-events-none"
										tabIndex={-1}
									/>
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">{e.description}</span>
										<span className="text-muted-foreground text-xs">
											{new Date(e.date).toLocaleDateString()} ·{" "}
											{e.amount} {e.currency}
										</span>
									</div>
								</div>
							))}
						</div>

						{/* Balances warning — adding to past changes what everyone owes. */}
						<p className="mx-6 mt-2 rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs">
							{t("rebalanceBalanceWarning", {
								name: participant?.name ?? "",
							})}
						</p>

						{/* Add-to-selected and future-only carry equal visual weight. */}
						<div className="flex flex-col gap-2 px-6 py-4">
							<Button
								type="button"
								disabled={selected.size === 0 || rebalanceMutation.isPending}
								onClick={() => runRebalance([...selected])}
							>
								{rebalanceMutation.isPending
									? t("adding")
									: t("includeSelected", { count: selected.size })}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={rebalanceMutation.isPending}
								onClick={close}
							>
								{t("futureOnly")}
							</Button>
						</div>
					</>
				)}
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

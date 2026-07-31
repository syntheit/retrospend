"use client";

import { useMemo, useState } from "react";
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
import { cn } from "~/lib/utils";

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
 * existing expenses. Offers three choices: future-only (default, no change),
 * all eligible past expenses, or a hand-picked subset. Only EQUAL-mode,
 * unlocked expenses are eligible for automatic rebalancing.
 */
export function RebalanceExpensesDialog({
	projectId,
	participant,
	onOpenChange,
}: RebalanceExpensesDialogProps) {
	const t = useTranslations("projects");
	const utils = api.useUtils();
	const [choosing, setChoosing] = useState(false);
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
		setChoosing(false);
		setSelected(new Set());
		onOpenChange(false);
	};

	const runRebalance = (expenseIds?: string[]) => {
		if (!participant) return;
		rebalanceMutation.mutate({
			projectId,
			participantType: participant.participantType,
			participantId: participant.participantId,
			...(expenseIds ? { expenseIds } : {}),
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
							: t("includeInExpensesDescription")}
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
				) : choosing ? (
					<>
						<div className="flex-1 overflow-y-auto px-3 py-2">
							{eligible.map((e) => (
								<button
									type="button"
									key={e.id}
									onClick={() => toggle(e.id)}
									className={cn(
										"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent",
									)}
								>
									<Checkbox checked={selected.has(e.id)} />
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">{e.description}</span>
										<span className="text-muted-foreground text-xs">
											{new Date(e.date).toLocaleDateString()} ·{" "}
											{e.amount} {e.currency}
										</span>
									</div>
								</button>
							))}
						</div>
						<div className="flex justify-between gap-2 border-t px-6 py-4">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setChoosing(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								type="button"
								disabled={selected.size === 0 || rebalanceMutation.isPending}
								onClick={() => runRebalance([...selected])}
							>
								{rebalanceMutation.isPending
									? t("adding")
									: t("includeSelected", { count: selected.size })}
							</Button>
						</div>
					</>
				) : (
					<div className="flex flex-col gap-2 px-6 pt-2 pb-6">
						<Button
							type="button"
							variant="outline"
							disabled={rebalanceMutation.isPending}
							onClick={() => runRebalance()}
						>
							{t("includeAllEligible", { count: eligible.length })}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={rebalanceMutation.isPending}
							onClick={() => setChoosing(true)}
						>
							{t("chooseExpenses")}
						</Button>
						<Button type="button" variant="ghost" onClick={close}>
							{t("futureOnly")}
						</Button>
					</div>
				)}
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { useRecurringModal } from "~/components/recurring-modal-provider";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { TableSearch } from "~/components/table-search";
import { useCurrency } from "~/hooks/use-currency";
import { api } from "~/trpc/react";
import { RecurringCalendar } from "./_components/recurring-calendar";
import { RecurringHistoryDrawer } from "./_components/recurring-history-drawer";
import { RecurringList } from "./_components/recurring-list";
import { PendingPayments } from "./_components/pending-payments";
import { RecurringProjections } from "./_components/recurring-projections";
import { RecurringStatsCards } from "./_components/recurring-stats-cards";

type SortKey = "nextPayment" | "amountDesc" | "amountAsc" | "nameAz";

export default function RecurringPage() {
	const { openNewRecurring, openRecurring } = useRecurringModal();
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [historyTemplateId, setHistoryTemplateId] = useState<string | null>(
		null,
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [sortBy, setSortBy] = useState<SortKey>("nextPayment");

	const { homeCurrency } = useCurrency();
	const utils = api.useUtils();

	// Server time for timezone-safe date comparisons
	const { data: serverTimeData } = api.system.getServerTime.useQuery(
		undefined,
		{ staleTime: 30_000 },
	);
	const serverTime = serverTimeData?.serverTime
		? new Date(serverTimeData.serverTime)
		: undefined;

	const { data: templates, isLoading } = api.recurring.list.useQuery();

	// Derive pending templates client-side from list data + server time
	const pendingTemplates = useMemo(() => {
		if (!templates || !serverTime) return [];
		return templates.filter(
			(t) => t.isActive && !t.autoPay && new Date(t.nextDueDate) <= serverTime,
		);
	}, [templates, serverTime]);

	const confirmAndCreate = api.recurring.confirmAndCreate.useMutation({
		onSuccess: () => {
			void utils.recurring.list.invalidate();
			toast.success("Payment confirmed and expense created");
		},
		onError: () => {
			toast.error("Failed to confirm payment");
		},
	});

	const deleteTemplate = api.recurring.delete.useMutation({
		onSuccess: () => {
			void utils.recurring.list.invalidate();
			setDeleteTarget(null);
			toast.success("Subscription deleted");
		},
		onError: () => {
			toast.error("Failed to delete subscription");
		},
	});

	// Pause/Resume toggle
	const togglePause = api.recurring.update.useMutation({
		onSuccess: (_data, variables) => {
			void utils.recurring.list.invalidate();
			toast.success(
				variables.isActive ? "Subscription resumed" : "Subscription paused",
			);
		},
		onError: () => {
			toast.error("Failed to update subscription");
		},
	});

	const handleDelete = (id: string) => {
		setDeleteTarget(id);
	};

	const handleEdit = (template: { id: string }) => {
		openRecurring(template.id);
	};

	const handleTogglePause = (id: string, isActive: boolean) => {
		togglePause.mutate({ id, isActive });
	};

	// Search + Sort
	const filteredTemplates = useMemo(() => {
		if (!templates) return undefined;

		let filtered = templates;

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(t) =>
					t.name.toLowerCase().includes(q) ||
					t.category?.name.toLowerCase().includes(q) ||
					t.paymentSource?.toLowerCase().includes(q),
			);
		}

		const sorted = [...filtered];
		switch (sortBy) {
			case "nextPayment":
				sorted.sort(
					(a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime(),
				);
				break;
			case "amountDesc":
				sorted.sort(
					(a, b) =>
						Number(b.amountInHomeCurrency) - Number(a.amountInHomeCurrency),
				);
				break;
			case "amountAsc":
				sorted.sort(
					(a, b) =>
						Number(a.amountInHomeCurrency) - Number(b.amountInHomeCurrency),
				);
				break;
			case "nameAz":
				sorted.sort((a, b) => a.name.localeCompare(b.name));
				break;
		}

		return sorted;
	}, [templates, searchQuery, sortBy]);

	const hasTemplates = templates && templates.length > 0;

	return (
		<>
			<SiteHeader
				actions={
					<Button
						aria-label="Add Recurring Expense"
						onClick={openNewRecurring}
					>
						<Plus className="h-4 w-4 sm:mr-2" />
						<span className="hidden sm:inline">Add Recurring Expense</span>
					</Button>
				}
				title="Recurring"
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl">
					<div className="flex items-start gap-6">
						{/* Main column */}
						<div className="min-w-0 flex-1 space-y-6">
							<RecurringStatsCards
								homeCurrency={homeCurrency}
								loading={isLoading}
								serverTime={serverTime}
								templates={templates}
							/>

							{/* Pending Payments */}
							{pendingTemplates && pendingTemplates.length > 0 && (
								<PendingPayments
									onConfirm={(id) => confirmAndCreate.mutate({ id })}
									pendingTemplates={pendingTemplates}
									confirmingId={
										confirmAndCreate.isPending
											? (confirmAndCreate.variables?.id ?? null)
											: null
									}
								/>
							)}

							<div className="space-y-3">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<h2 className="font-semibold text-lg">
											Your Subscriptions
										</h2>
										<p className="text-muted-foreground text-sm">
											Manage your recurring expenses and subscriptions
										</p>
									</div>
									{hasTemplates && (
										<div className="flex items-center gap-2">
											<TableSearch
												className="w-full sm:w-48"
												onChange={setSearchQuery}
												placeholder="Search subscriptions..."
												value={searchQuery}
											/>
											<Select
												onValueChange={(v) => setSortBy(v as SortKey)}
												value={sortBy}
											>
												<SelectTrigger className="w-[160px] shrink-0">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="nextPayment">
														Next payment
													</SelectItem>
													<SelectItem value="amountDesc">
														Amount (high → low)
													</SelectItem>
													<SelectItem value="amountAsc">
														Amount (low → high)
													</SelectItem>
													<SelectItem value="nameAz">Name A-Z</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</div>

								<RecurringList
									loading={isLoading}
									onCreate={openNewRecurring}
									onDelete={handleDelete}
									onEdit={handleEdit}
									onTogglePause={handleTogglePause}
									onViewHistory={setHistoryTemplateId}
									templates={filteredTemplates}
								/>
							</div>
						</div>

						{/* Sidebar — hidden below lg, hidden when no templates */}
						{(isLoading || hasTemplates) && (
							<aside className="sticky top-6 hidden w-[280px] shrink-0 space-y-4 lg:block">
								<RecurringCalendar
									loading={isLoading}
									serverTime={serverTime}
									templates={templates}
								/>
								<RecurringProjections
									homeCurrency={homeCurrency}
									loading={isLoading}
									templates={templates}
								/>
							</aside>
						)}
					</div>
				</div>
			</PageContent>

			<RecurringHistoryDrawer
				onClose={() => setHistoryTemplateId(null)}
				templateId={historyTemplateId}
			/>

			<ConfirmationDialog
				confirmLabel="Delete"
				description="This will permanently remove the recurring expense. This action cannot be undone."
				isLoading={deleteTemplate.isPending}
				onConfirm={() => deleteTarget && deleteTemplate.mutate({ id: deleteTarget })}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
				open={deleteTarget !== null}
				title="Delete subscription?"
				variant="destructive"
			/>
		</>
	);
}

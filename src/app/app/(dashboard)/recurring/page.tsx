"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { RecurringModal } from "~/components/recurring-modal";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { useCurrency } from "~/hooks/use-currency";
import { api } from "~/trpc/react";
import { RecurringList } from "./_components/recurring-list";
import { RecurringStatsCards } from "./_components/recurring-stats-cards";

export default function RecurringPage() {
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<string | null>(null);

	const { homeCurrency } = useCurrency();
	const utils = api.useUtils();

	const { data: templates, isLoading } = api.recurring.list.useQuery();

	const deleteTemplate = api.recurring.delete.useMutation({
		onSuccess: () => {
			utils.recurring.list.invalidate();
			toast.success("Subscription deleted");
		},
		onError: () => {
			toast.error("Failed to delete subscription");
		},
	});

	const handleDelete = (id: string) => {
		if (confirm("Are you sure you want to delete this subscription?")) {
			deleteTemplate.mutate({ id });
		}
	};

	const handleEdit = (template: { id: string }) => {
		setEditingTemplate(template.id);
	};

	const handleCloseModal = () => {
		setShowCreateModal(false);
		setEditingTemplate(null);
	};

	return (
		<>
			<SiteHeader
				actions={
					templates && templates.length > 0 ? (
						<Button onClick={() => setShowCreateModal(true)}>
							<Plus className="mr-2 h-4 w-4" /> Add Recurring Expense
						</Button>
					) : null
				}
				title="Recurring & Subscriptions"
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-6">
					<RecurringStatsCards
						homeCurrency={homeCurrency}
						loading={isLoading}
						templates={templates?.map((t) => ({
							...t,
							amount: Number(t.amount),
							amountInHomeCurrency: Number(t.amountInHomeCurrency),
							nextDueDate: new Date(t.nextDueDate),
						}))}
					/>

					<div className="space-y-4">
						<div>
							<h2 className="font-semibold text-lg">Your Subscriptions</h2>
							<p className="text-muted-foreground text-sm">
								Manage your recurring expenses and subscriptions
							</p>
						</div>
						<RecurringList
							loading={isLoading}
							onCreate={() => setShowCreateModal(true)}
							onDelete={handleDelete}
							onEdit={handleEdit}
							templates={templates?.map((t) => ({
								...t,
								amount: Number(t.amount),
								amountInHomeCurrency: Number(t.amountInHomeCurrency),
								exchangeRate: Number(t.exchangeRate),
								nextDueDate: new Date(t.nextDueDate),
							}))}
						/>
					</div>
				</div>
			</PageContent>

			{(showCreateModal || editingTemplate) && (
				<RecurringModal
					onClose={handleCloseModal}
					open={showCreateModal || !!editingTemplate}
					templateId={editingTemplate}
				/>
			)}
		</>
	);
}

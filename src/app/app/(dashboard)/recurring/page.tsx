"use client";

import { Calendar, List, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { RecurringModal } from "~/components/recurring-modal";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { useCurrency } from "~/hooks/use-currency";
import { api } from "~/trpc/react";
import { RecurringCalendar } from "./_components/recurring-calendar";
import { RecurringList } from "./_components/recurring-list";
import { RecurringStatsCards } from "./_components/recurring-stats-cards";

type ViewMode = "list" | "calendar";

export default function RecurringPage() {
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<ViewMode>("list");

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
		toast("Delete subscription?", {
			description: "This will permanently remove the recurring expense.",
			action: {
				label: "Delete",
				onClick: () => deleteTemplate.mutate({ id }),
			},
		});
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
						<div className="flex items-center gap-2">
							{/* View Toggle */}
							<div className="flex items-center rounded-lg border bg-background p-1">
								<Button
									onClick={() => setViewMode("list")}
									size="sm"
									variant={viewMode === "list" ? "secondary" : "ghost"}
								>
									<List className="mr-2 h-4 w-4" />
									List
								</Button>
								<Button
									onClick={() => setViewMode("calendar")}
									size="sm"
									variant={viewMode === "calendar" ? "secondary" : "ghost"}
								>
									<Calendar className="mr-2 h-4 w-4" />
									Calendar
								</Button>
							</div>

							{/* Add Button */}
							<Button onClick={() => setShowCreateModal(true)}>
								<Plus className="mr-2 h-4 w-4" /> Add Recurring Expense
							</Button>
						</div>
					) : null
				}
				title="Recurring & Subscriptions"
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-6xl space-y-6">
					<RecurringStatsCards
						homeCurrency={homeCurrency}
						loading={isLoading}
						templates={templates}
					/>
 
 					<div className="space-y-4">
 						<div>
 							<h2 className="font-semibold text-lg">Your Subscriptions</h2>
 							<p className="text-muted-foreground text-sm">
 								Manage your recurring expenses and subscriptions
 							</p>
 						</div>
 
 						{viewMode === "list" ? (
 							<RecurringList
 								loading={isLoading}
 								onCreate={() => setShowCreateModal(true)}
 								onDelete={handleDelete}
 								onEdit={handleEdit}
 								templates={templates}
 							/>
 						) : (
 							<RecurringCalendar
 								loading={isLoading}
 								templates={templates}
 							/>
 						)}
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

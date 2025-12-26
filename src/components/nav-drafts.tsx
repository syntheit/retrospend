"use client";

import { useMemo } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";
import { api } from "~/trpc/react";

export function NavDrafts() {
	const { openExpense, expenseId, isOpen } = useExpenseModal();

	// Fetch draft expenses
	const { data: drafts } = api.expense.listDrafts.useQuery();

	// Group drafts by title and add numbering for duplicates
	const processedDrafts = useMemo(() => {
		if (!drafts) return [];

		const titleCount: Record<string, number> = {};
		const processed: Array<{
			id: string;
			displayTitle: string;
			title: string;
		}> = [];

		// Count occurrences of each title
		drafts.forEach((draft: { title: string | null; id: string }) => {
			const baseTitle = draft.title || "Untitled Expense";
			titleCount[baseTitle] = (titleCount[baseTitle] || 0) + 1;
		});

		// Create display titles with numbering
		drafts.forEach((draft: { title: string | null; id: string }) => {
			const baseTitle = draft.title || "Untitled Expense";
			let displayTitle = baseTitle;

			if ((titleCount[baseTitle] || 0) > 1) {
				// Find the index of this draft among drafts with the same title
				const sameTitleDrafts = drafts.filter(
					(d: { title: string | null; id: string }) =>
						(d.title || "Untitled Expense") === baseTitle,
				);
				const index =
					sameTitleDrafts.findIndex(
						(d: { title: string | null; id: string }) => d.id === draft.id,
					) + 1;
				displayTitle = `${baseTitle} #${index}`;
			}

			processed.push({
				id: draft.id,
				displayTitle,
				title: baseTitle,
			});
		});

		return processed;
	}, [drafts]);

	// Only show the section if there are drafts available
	if (processedDrafts.length === 0) {
		return null;
	}

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Drafts</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{processedDrafts.map((draft) => (
						<SidebarMenuItem key={draft.id}>
							<SidebarMenuButton
								className={
									isOpen && expenseId === draft.id ? "bg-sidebar-accent" : ""
								}
								onClick={() => openExpense(draft.id)}
								tooltip={draft.displayTitle}
							>
								<span className="truncate">{draft.displayTitle}</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

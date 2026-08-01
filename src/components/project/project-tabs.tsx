"use client";

import { Activity, Receipt, Share2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { ActivityTab } from "~/components/project/activity-tab";
import { PeopleTab } from "~/components/project/people-tab";
import { ShareProjectDialog } from "~/components/project/share-project-dialog";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

const TAB_VALUES = ["expenses", "people", "activity"] as const;
type TabValue = (typeof TAB_VALUES)[number];

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

interface ProjectTabsProps {
	projectId: string;
	projectName: string;
	createdById: string;
	participants: Participant[];
	primaryCurrency: string;
	isOrganizer: boolean;
	isEditor: boolean;
	isSolo: boolean;
	currentUserId: string | undefined;
	/** The Expenses experience (BudgetCard + BillingPeriodTabs + ExpensesTable), lifted from the page. */
	expensesPanel: ReactNode;
}

// Tabbed project surface: Expenses · People · Activity. The active tab is
// URL-synced via ?tab=. Only used inside AuthenticatedProjectView — guest,
// viewer and public views are untouched. Solo projects (a single participant)
// have no People/Activity to speak of, so they render the Expenses panel alone.
export function ProjectTabs({
	projectId,
	projectName,
	createdById,
	participants,
	primaryCurrency,
	isOrganizer,
	isEditor,
	isSolo,
	currentUserId,
	expensesPanel,
}: ProjectTabsProps) {
	const t = useTranslations("projects");
	const router = useRouter();
	const searchParams = useSearchParams();
	const [shareOpen, setShareOpen] = useState(false);

	const paramTab = searchParams.get("tab");
	const activeTab: TabValue = useMemo(() => {
		return TAB_VALUES.includes(paramTab as TabValue)
			? (paramTab as TabValue)
			: "expenses";
	}, [paramTab]);

	// Follow the page's existing replaceState-based param handling: update ?tab
	// without a full navigation so period/filter state below is preserved.
	const handleTabChange = useCallback(
		(value: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (value === "expenses") {
				params.delete("tab");
			} else {
				params.set("tab", value);
			}
			const query = params.toString();
			router.replace(query ? `?${query}` : "?", { scroll: false });
		},
		[router, searchParams],
	);

	// Solo projects: no roster / activity worth a tab. Keep the expenses view
	// exactly as it was, with just a Share affordance if the project is shared.
	if (isSolo) {
		return (
			<div className="flex flex-1 flex-col gap-4">
				{expensesPanel}
			</div>
		);
	}

	return (
		<>
			<Tabs
				className="flex flex-1 flex-col gap-4"
				onValueChange={handleTabChange}
				value={activeTab}
			>
				<div className="flex items-center justify-between gap-3">
					<TabsList>
						<TabsTrigger value="expenses">
							<Receipt className="h-4 w-4" />
							{t("tabExpenses")}
						</TabsTrigger>
						<TabsTrigger value="people">
							<Users className="h-4 w-4" />
							{t("tabPeople")}
						</TabsTrigger>
						<TabsTrigger value="activity">
							<Activity className="h-4 w-4" />
							{t("tabActivity")}
						</TabsTrigger>
					</TabsList>
					<Button onClick={() => setShareOpen(true)} size="sm" variant="outline">
						<Share2 className="mr-1 h-4 w-4" />
						{t("share")}
					</Button>
				</div>

				{/* Expenses: force-mounted so switching tabs never resets the selected
				    billing period or expense filters (Radix unmounts inactive content). */}
				<TabsContent
					className="mt-0 flex flex-col gap-4 data-[state=inactive]:hidden"
					forceMount
					value="expenses"
				>
					{expensesPanel}
				</TabsContent>

				<TabsContent className="mt-0" value="people">
					<PeopleTab
						createdById={createdById}
						currentUserId={currentUserId}
						isEditor={isEditor}
						isOrganizer={isOrganizer}
						participants={participants}
						primaryCurrency={primaryCurrency}
						projectId={projectId}
						projectName={projectName}
					/>
				</TabsContent>

				<TabsContent className="mt-0" value="activity">
					<ActivityTab projectId={projectId} />
				</TabsContent>
			</Tabs>

			<ShareProjectDialog
				createdById={createdById}
				isEditor={isEditor}
				isOrganizer={isOrganizer}
				onOpenChange={setShareOpen}
				open={shareOpen}
				projectId={projectId}
				projectName={projectName}
			/>
		</>
	);
}

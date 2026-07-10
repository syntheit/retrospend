"use client";

import {
	BarChart3,
	Globe,
	Receipt,
	Settings2,
	Smartphone,
	Target,
	TrendingUp,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { MonthStepper } from "~/components/date/MonthStepper";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { useDashboardLayout } from "~/hooks/use-dashboard-layout";
import { api } from "~/trpc/react";
import { AddWidgetSheet } from "./_components/add-widget-sheet";
import { DashboardGrid } from "./_components/dashboard-grid";
import { SortableWidget } from "./_components/sortable-widget";
import { WidgetCard } from "./_components/widget-card";
import { WidgetErrorBoundary } from "./_components/widget-error-boundary";
import {
	DashboardProvider,
	useDashboardContext,
} from "./_lib/dashboard-context";
import {
	WIDGET_REGISTRY,
	type LayoutItem,
	type WidgetSize,
} from "./_lib/widget-registry";

// Lazy-load widget components
const widgetComponents: Record<
	string,
	React.LazyExoticComponent<React.ComponentType<{ isEditMode: boolean }>>
> = {};

function getWidgetComponent(id: string) {
	if (!widgetComponents[id]) {
		const def = WIDGET_REGISTRY[id];
		if (!def) return null;
		widgetComponents[id] = lazy(def.component);
	}
	return widgetComponents[id];
}

function WidgetSkeleton({ size }: { size: WidgetSize }) {
	const height = size === "sm" ? "h-32" : size === "md" ? "h-[250px]" : "h-[350px]";
	return <Skeleton className={`${height} w-full rounded-xl`} />;
}

export default function Page() {
	const t = useTranslations("dashboard");
	const [isEditMode, setIsEditMode] = useState(false);
	const { visibleWidgets, hiddenWidgets, isLoading: layoutLoading, actions } =
		useDashboardLayout();

	return (
		<DashboardProvider>
			<DashboardContent
				actions={actions}
				hiddenWidgets={hiddenWidgets}
				isEditMode={isEditMode}
				layoutLoading={layoutLoading}
				setIsEditMode={setIsEditMode}
				visibleWidgets={visibleWidgets}
			/>
		</DashboardProvider>
	);
}

function DashboardContent({
	visibleWidgets,
	hiddenWidgets,
	isEditMode,
	setIsEditMode,
	layoutLoading,
	actions,
}: {
	visibleWidgets: LayoutItem[];
	hiddenWidgets: LayoutItem[];
	isEditMode: boolean;
	setIsEditMode: (v: boolean) => void;
	layoutLoading: boolean;
	actions: ReturnType<typeof useDashboardLayout>["actions"];
}) {
	const t = useTranslations("dashboard");
	const { state, data, actions: dashActions } = useDashboardContext();
	const { data: claimedShadowCount = 0 } = api.people.claimedShadowCount.useQuery(
		undefined,
		{ enabled: state.isUsingMockExpenses },
	);

	const [showResetConfirm, setShowResetConfirm] = useState(false);

	const sortableIds = useMemo(
		() => visibleWidgets.map((w) => w.id),
		[visibleWidgets],
	);

	const handleReorder = useCallback(
		(activeId: string, overId: string) => {
			actions.reorder(activeId, overId);
		},
		[actions],
	);

	const renderOnboarding = () => (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					{t("welcomeTitle")}
				</CardTitle>
				<CardDescription>{t("welcomeDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-2">
				<Button onClick={dashActions.handleCreateExpense}>
					{t("addExpense")}
				</Button>
				<Button asChild variant="outline">
					<Link href="/transactions">{t("goToTransactions")}</Link>
				</Button>
				<span className="text-muted-foreground text-xs">
					{t("sampleDataHint")}
				</span>
			</CardContent>
		</Card>
	);

	const renderUpgradeWelcome = () => (
		<Card className="border-dashed">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">
					{t("welcomeTitle")}
				</CardTitle>
				<CardDescription>{t("upgradeDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground text-sm">
					{t("upgradeExploreText")}
				</p>
				<ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-muted-foreground text-sm sm:grid-cols-2">
					<li className="flex items-center gap-2">
						<Smartphone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeAccessFromDevice")}
					</li>
					<li className="flex items-center gap-2">
						<BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeSpendingTracking")}
					</li>
					<li className="flex items-center gap-2">
						<Target className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeBudgets")}
					</li>
					<li className="flex items-center gap-2">
						<TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeWealth")}
					</li>
					<li className="flex items-center gap-2">
						<Globe className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeMultiCurrency")}
					</li>
					<li className="flex items-center gap-2">
						<Receipt className="h-3.5 w-3.5 shrink-0 text-primary/70" />
						{t("upgradeBankImports")}
					</li>
				</ul>
				<div className="flex flex-wrap items-center gap-2 pt-1">
					<Button onClick={dashActions.handleCreateExpense}>
						{t("addFirstExpense")}
					</Button>
					<Button asChild variant="outline">
						<Link href="/transactions">{t("goToTransactions")}</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);

	return (
		<>
			<SiteHeader
				actions={
					<div className="flex items-center gap-2">
						<MonthStepper
							maxDate={state.serverTime}
							minDate={data.earliestBudgetMonth ?? undefined}
							onChange={dashActions.setSelectedMonth}
							value={state.selectedMonth}
						/>
						{isEditMode ? (
							<Button
								onClick={() => setIsEditMode(false)}
								size="sm"
								variant="outline"
							>
								<X className="mr-2 h-4 w-4" />
								{t("done")}
							</Button>
						) : (
							<Button
								onClick={() => setIsEditMode(true)}
								size="sm"
								variant="ghost"
							>
								<Settings2 className="mr-2 h-4 w-4" />
								{t("customize")}
							</Button>
						)}
					</div>
				}
				title={t("title")}
			/>
			<PageContent>
				<div className="flex flex-col gap-4">
					{isEditMode && (
						<div className="flex items-center gap-3">
							<AddWidgetSheet
								hiddenWidgets={hiddenWidgets}
								onAdd={actions.addWidget}
							/>
							<Button
								className="text-destructive"
								onClick={() => setShowResetConfirm(true)}
								size="sm"
								variant="ghost"
							>
								{t("resetToDefault")}
							</Button>
						</div>
					)}

					{state.isUsingMockExpenses &&
						(claimedShadowCount > 0
							? renderUpgradeWelcome()
							: renderOnboarding())}

					{layoutLoading ? (
						<div className="grid grid-cols-12 gap-4">
							{Array.from({ length: 5 }).map((_, i) => (
								<Skeleton
									className="col-span-12 h-32 w-full rounded-xl md:col-span-6 lg:col-span-4"
									key={`skel-${i}`}
								/>
							))}
						</div>
					) : (
						<DashboardGrid
							isEditMode={isEditMode}
							onReorder={handleReorder}
							sortableIds={sortableIds}
						>
							{visibleWidgets.map((item) => {
								const def = WIDGET_REGISTRY[item.id];
								if (!def) return null;
								const Component = getWidgetComponent(item.id);
								if (!Component) return null;

								return (
									<SortableWidget
										id={item.id}
										isEditMode={isEditMode}
										key={item.id}
										size={item.size}
									>
										{({ isDragging, dragHandleProps }) => (
											<WidgetCard
												definition={def}
												dragHandleProps={dragHandleProps}
												isDragging={isDragging}
												isEditMode={isEditMode}
												item={item}
												onSizeChange={(size: WidgetSize) =>
													actions.setSize(item.id, size)
												}
												onToggleVisibility={() =>
													actions.toggleVisibility(item.id)
												}
											>
												<WidgetErrorBoundary widgetName={def.id}>
													<Suspense
														fallback={
															<WidgetSkeleton size={item.size} />
														}
													>
														<Component isEditMode={isEditMode} />
													</Suspense>
												</WidgetErrorBoundary>
											</WidgetCard>
										)}
									</SortableWidget>
								);
							})}
						</DashboardGrid>
					)}

				</div>
			</PageContent>
			<ConfirmationDialog
				confirmLabel={t("resetToDefault")}
				description={t("resetToDefaultDescription")}
				onConfirm={() => {
					actions.resetToDefault();
					setShowResetConfirm(false);
				}}
				onOpenChange={setShowResetConfirm}
				open={showResetConfirm}
				title={t("resetToDefaultTitle")}
				variant="destructive"
			/>
		</>
	);
}

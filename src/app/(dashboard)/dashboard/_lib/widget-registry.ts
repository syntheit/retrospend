import type { LucideIcon } from "lucide-react";
import {
	Activity,
	ArrowLeftRight,
	CalendarDays,
	CircleDollarSign,
	Globe,
	Landmark,
	PieChart,
	Receipt,
	ShieldCheck,
	TrendingUp,
	Wallet,
	BarChart3,
	Percent,
} from "lucide-react";

export type WidgetSize = "xs" | "sm" | "md" | "lg";
export type WidgetCategory = "overview" | "budget" | "social" | "wealth" | "tools";

export interface WidgetProps {
	isEditMode: boolean;
}

export interface WidgetDefinition {
	id: string;
	name: string;
	description: string;
	icon: LucideIcon;
	defaultSize: WidgetSize;
	minSize: WidgetSize;
	category: WidgetCategory;
	tier: 1 | 2;
	component: () => Promise<{ default: React.ComponentType<WidgetProps> }>;
}

export interface LayoutItem {
	id: string;
	visible: boolean;
	size: WidgetSize;
	order: number;
}

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
	"safe-to-spend": {
		id: "safe-to-spend",
		name: "widgets.safeToSpend.name",
		description: "widgets.safeToSpend.description",
		icon: ShieldCheck,
		defaultSize: "sm",
		minSize: "xs",
		category: "budget",
		tier: 1,
		component: () => import("../_widgets/safe-to-spend-widget"),
	},
	"monthly-summary": {
		id: "monthly-summary",
		name: "widgets.monthlySummary.name",
		description: "widgets.monthlySummary.description",
		icon: Wallet,
		defaultSize: "sm",
		minSize: "xs",
		category: "overview",
		tier: 1,
		component: () => import("../_widgets/monthly-summary-widget"),
	},
	"budget-pacing": {
		id: "budget-pacing",
		name: "widgets.budgetPacing.name",
		description: "widgets.budgetPacing.description",
		icon: TrendingUp,
		defaultSize: "lg",
		minSize: "md",
		category: "budget",
		tier: 1,
		component: () => import("../_widgets/budget-pacing-widget"),
	},
	"recent-activity": {
		id: "recent-activity",
		name: "widgets.recentActivity.name",
		description: "widgets.recentActivity.description",
		icon: Activity,
		defaultSize: "md",
		minSize: "sm",
		category: "overview",
		tier: 1,
		component: () => import("../_widgets/recent-activity-widget"),
	},
	"category-breakdown": {
		id: "category-breakdown",
		name: "widgets.categoryBreakdown.name",
		description: "widgets.categoryBreakdown.description",
		icon: PieChart,
		defaultSize: "md",
		minSize: "sm",
		category: "overview",
		tier: 1,
		component: () => import("../_widgets/category-breakdown-widget"),
	},
	"upcoming-recurring": {
		id: "upcoming-recurring",
		name: "widgets.upcomingRecurring.name",
		description: "widgets.upcomingRecurring.description",
		icon: CalendarDays,
		defaultSize: "md",
		minSize: "sm",
		category: "budget",
		tier: 2,
		component: () => import("../_widgets/upcoming-recurring-widget"),
	},
	"net-worth-snapshot": {
		id: "net-worth-snapshot",
		name: "widgets.netWorthSnapshot.name",
		description: "widgets.netWorthSnapshot.description",
		icon: Landmark,
		defaultSize: "xs",
		minSize: "xs",
		category: "wealth",
		tier: 2,
		component: () => import("../_widgets/net-worth-snapshot-widget"),
	},
	"people-balances": {
		id: "people-balances",
		name: "widgets.peopleBalances.name",
		description: "widgets.peopleBalances.description",
		icon: ArrowLeftRight,
		defaultSize: "xs",
		minSize: "xs",
		category: "social",
		tier: 2,
		component: () => import("../_widgets/people-balances-widget"),
	},
	"pending-actions": {
		id: "pending-actions",
		name: "widgets.pendingActions.name",
		description: "widgets.pendingActions.description",
		icon: Receipt,
		defaultSize: "xs",
		minSize: "xs",
		category: "overview",
		tier: 2,
		component: () => import("../_widgets/pending-actions-widget"),
	},
	"currency-watchlist": {
		id: "currency-watchlist",
		name: "widgets.currencyWatchlist.name",
		description: "widgets.currencyWatchlist.description",
		icon: Globe,
		defaultSize: "xs",
		minSize: "xs",
		category: "tools",
		tier: 2,
		component: () => import("../_widgets/currency-watchlist-widget"),
	},
	"savings-rate": {
		id: "savings-rate",
		name: "widgets.savingsRate.name",
		description: "widgets.savingsRate.description",
		icon: Percent,
		defaultSize: "xs",
		minSize: "xs",
		category: "overview",
		tier: 2,
		component: () => import("../_widgets/savings-rate-widget"),
	},
	"monthly-comparison": {
		id: "monthly-comparison",
		name: "widgets.monthlyComparison.name",
		description: "widgets.monthlyComparison.description",
		icon: BarChart3,
		defaultSize: "md",
		minSize: "md",
		category: "overview",
		tier: 2,
		component: () => import("../_widgets/monthly-comparison-widget"),
	},
} as const;

export const DEFAULT_LAYOUT: LayoutItem[] = [
	{ id: "safe-to-spend", visible: true, size: "sm", order: 0 },
	{ id: "monthly-summary", visible: true, size: "sm", order: 1 },
	{ id: "budget-pacing", visible: true, size: "lg", order: 2 },
	{ id: "recent-activity", visible: true, size: "md", order: 3 },
	{ id: "category-breakdown", visible: true, size: "md", order: 4 },
	{ id: "upcoming-recurring", visible: false, size: "md", order: 5 },
	{ id: "net-worth-snapshot", visible: false, size: "xs", order: 6 },
	{ id: "people-balances", visible: false, size: "xs", order: 7 },
	{ id: "pending-actions", visible: false, size: "xs", order: 8 },
	{ id: "currency-watchlist", visible: false, size: "xs", order: 9 },
	{ id: "savings-rate", visible: false, size: "xs", order: 10 },
	{ id: "monthly-comparison", visible: false, size: "md", order: 11 },
];

export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
	return WIDGET_REGISTRY[id];
}

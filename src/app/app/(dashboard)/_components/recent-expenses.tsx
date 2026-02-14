"use client";

import { format } from "date-fns";
import {
	Book,
	Briefcase,
	Bus,
	Car,
	Clapperboard,
	Coffee,
	CreditCard,
	Dumbbell,
	Film,
	Gamepad as GamepadIcon,
	GraduationCap,
	Heart,
	Home,
	Laptop,
	Martini,
	Music,
	PartyPopper,
	Plane,
	Receipt,
	ShoppingBag,
	ShoppingCart,
	Smartphone,
	Star,
	Train,
	Tv,
	Utensils,
	Wifi,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import type { CATEGORY_COLOR_MAP } from "~/lib/constants";
import type { NormalizedExpense } from "~/lib/utils";
import { cn, convertExpenseAmountForDisplay } from "~/lib/utils";

// Explicit map to ensure Tailwind generates these classes
const MUTED_COLOR_MAP: Record<string, string> = {
	emerald: "bg-emerald-500/10 text-emerald-500",
	blue: "bg-blue-500/10 text-blue-500",
	sky: "bg-sky-500/10 text-sky-500",
	cyan: "bg-cyan-500/10 text-cyan-500",
	teal: "bg-teal-500/10 text-teal-500",
	orange: "bg-orange-500/10 text-orange-500",
	amber: "bg-amber-500/10 text-amber-500",
	violet: "bg-violet-500/10 text-violet-500",
	pink: "bg-pink-500/10 text-pink-500",
	fuchsia: "bg-fuchsia-500/10 text-fuchsia-500",
	indigo: "bg-indigo-500/10 text-indigo-500",
	slate: "bg-slate-500/10 text-slate-500",
	zinc: "bg-zinc-500/10 text-zinc-500",
	lime: "bg-lime-500/10 text-lime-500",
	neutral: "bg-neutral-500/10 text-neutral-500",
	gray: "bg-gray-500/10 text-gray-500",
	purple: "bg-purple-500/10 text-purple-500",
	yellow: "bg-yellow-500/10 text-yellow-500",
	stone: "bg-stone-500/10 text-stone-500",
	rose: "bg-rose-500/10 text-rose-500",
	red: "bg-red-500/10 text-red-500",
};

const CATEGORY_ICON_MAP: Record<string, React.ElementType> = {
	Groceries: ShoppingCart,
	"Dining Out": Utensils,
	Cafe: Coffee,
	"Food Delivery": ShoppingBag,
	Drinks: Martini,
	Rent: Home,
	Utilities: Zap,
	Health: Heart,
	Transport: Bus,
	Travel: Car,
	Tech: Laptop,
	Subscriptions: CreditCard,
	Education: GraduationCap,
	Misc: Receipt,
	Fees: Receipt,
	Taxes: Receipt,
	Social: PartyPopper,
	Date: Heart,
	Household: Home,
	Hobby: Star,
	Gas: Car,
	Rideshare: Car,
	Gym: Dumbbell,
	Work: Briefcase,
};

// Basic keyword matching for brands
const BRAND_ICON_MAP: Record<string, React.ElementType> = {
	uber: Car,
	lyft: Car,
	amazon: ShoppingBag,
	netflix: Tv,
	spotify: Music,
	apple: Smartphone,
	starbucks: Coffee,
	mcdonalds: Utensils,
	burger: Utensils,
	subway: Train, // Or Utensils? Usually food... let's say Utensils for "Subway" sandwiches, but "Subway" transport? Assuming food.
	airbnb: Home,
	hotel: Home,
	flight: Plane,
	airline: Plane,
	delta: Plane,
	united: Plane,
	american: Plane,
	shell: Car,
	exxon: Car,
	bp: Car,
	chevron: Car,
	texaco: Car,
	target: ShoppingCart,
	walmart: ShoppingCart,
	kroger: ShoppingCart,
	costco: ShoppingCart,
	whole: ShoppingCart,
	trader: ShoppingCart,
	safeway: ShoppingCart,
	publix: ShoppingCart,
	aldi: ShoppingCart,
	lidl: ShoppingCart,
	heb: ShoppingCart,
	wegmans: ShoppingCart,
	cinema: Clapperboard,
	movie: Clapperboard,
	theatre: Clapperboard,
	theater: Clapperboard,
	kindle: Book,
	audible: Book,
	steam: GamepadIcon,
	nintendo: Laptop,
	xbox: Laptop,
	playstation: Laptop,
	internet: Wifi,
	wifi: Wifi,
	comcast: Wifi,
	verizon: Wifi,
	att: Wifi,
	tmobile: Wifi,
};

function getExpenseIcon(title: string | null, categoryName: string) {
	if (title) {
		const lowerTitle = title.toLowerCase();
		// Check for exact keywords or partial matches
		for (const [keyword, icon] of Object.entries(BRAND_ICON_MAP)) {
			if (lowerTitle.includes(keyword)) {
				return icon;
			}
		}
	}
	// Fallback to category icon
	return CATEGORY_ICON_MAP[categoryName] ?? CreditCard;
}

interface RecentExpensesProps {
	expensesLoading: boolean;
	recentExpenses: NormalizedExpense[];
	homeCurrency: string;
	liveRateToBaseCurrency: number | null;
	formatCurrency: (amount: number, currency?: string) => string;
}

export function RecentExpenses({
	expensesLoading,
	recentExpenses,
	homeCurrency,
	liveRateToBaseCurrency,
	formatCurrency,
}: RecentExpensesProps) {
	if (expensesLoading) {
		return (
			<RecentExpensesCard>
				<div className="space-y-2">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			</RecentExpensesCard>
		);
	}

	if (recentExpenses.length === 0) {
		return (
			<RecentExpensesCard>
				<div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
					<div>
						<div className="font-medium">No expenses yet</div>
						<p className="text-muted-foreground text-sm">
							Create your first expense to see it here.
						</p>
					</div>
				</div>
			</RecentExpensesCard>
		);
	}

	return (
		<RecentExpensesCard>
			<div className="scrollbar-thin scrollbar-thumb-stone-700 scrollbar-track-transparent max-h-[500px] overflow-y-auto rounded-lg border bg-background/40 p-2 sm:border-0 sm:bg-transparent sm:p-0">
				<Table className="w-full table-fixed">
					<TableHeader>
						<TableRow>
							<TableHead className="w-1/2">Expense</TableHead>
							<TableHead className="w-1/4">Date</TableHead>
							<TableHead className="w-1/4 text-right">Amount</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{recentExpenses.map((expense) => (
							<RecentExpenseRow
								expense={expense}
								formatCurrency={formatCurrency}
								homeCurrency={homeCurrency}
								key={expense.id}
								liveRateToBaseCurrency={liveRateToBaseCurrency}
							/>
						))}
					</TableBody>
				</Table>
			</div>
		</RecentExpensesCard>
	);
}

function RecentExpensesCard({ children }: { children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between">
				<div>
					<CardTitle className="font-semibold text-lg">
						Recent Activity
					</CardTitle>
					<CardDescription>Latest finalized expenses</CardDescription>
				</div>
				<Button asChild size="sm" variant="ghost">
					<Link href="/app/table">View all</Link>
				</Button>
			</CardHeader>
			<CardContent className="px-4 sm:px-6">{children}</CardContent>
		</Card>
	);
}

interface RecentExpenseRowProps {
	expense: NormalizedExpense;
	homeCurrency: string;
	liveRateToBaseCurrency: number | null;
	formatCurrency: (amount: number, currency?: string) => string;
}

const RecentExpenseRow = memo(function RecentExpenseRow({
	expense,
	homeCurrency,
	liveRateToBaseCurrency,
	formatCurrency,
}: RecentExpenseRowProps) {
	const amount = convertExpenseAmountForDisplay(
		expense,
		homeCurrency,
		liveRateToBaseCurrency,
	);

	const showOriginal =
		expense.currency !== homeCurrency && (expense.amountInUSD ?? null) !== null;

	const categoryName = expense.category?.name ?? "Uncategorized";
	const colorKey = expense.category?.color as keyof typeof CATEGORY_COLOR_MAP;
	const Icon = getExpenseIcon(expense.title, categoryName);

	return (
		<TableRow>
			<TableCell>
				<div className="flex min-w-0 items-center gap-3">
					<div
						className={cn(
							"flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
							MUTED_COLOR_MAP[colorKey] ?? "bg-stone-500/10 text-stone-500",
						)}
					>
						<Icon className="h-4 w-4" />
					</div>

					<div className="min-w-0 space-y-0.5">
						<div className="truncate font-medium text-sm">
							{expense.title || "Untitled expense"}
						</div>
						<div className="truncate text-muted-foreground text-xs">
							{categoryName}
						</div>
					</div>
				</div>
			</TableCell>
			<TableCell className="whitespace-nowrap text-muted-foreground text-sm">
				{format(expense.date, "MMM d")}
			</TableCell>
			<TableCell className="whitespace-nowrap text-right">
				<div className="font-medium text-foreground text-sm">
					{formatCurrency(amount, homeCurrency)}
				</div>
				{showOriginal && (
					<div className="mt-0.5 text-[10px] text-muted-foreground">
						{formatCurrency(expense.amount, expense.currency)}
					</div>
				)}
			</TableCell>
		</TableRow>
	);
});

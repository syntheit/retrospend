"use client";

import {
	CreditCard,
	FolderKanban,
	Link2,
	Plane,
	Users,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

const BALANCES = [
	{ name: "Alex", amount: 127.5 },
	{ name: "Jordan", amount: 48.0 },
	{ name: "Sam", amount: -35.0 },
	{ name: "Maya", amount: 12.0 },
];

const RECENT_SPLITS = [
	{
		title: "Airbnb",
		total: 640,
		yourShare: 160,
		project: "Beach House",
		paidBy: "You",
		people: 4,
		mode: "Equal",
		status: "verified" as const,
	},
	{
		title: "Groceries run",
		total: 124.8,
		yourShare: 31.2,
		project: "Beach House",
		paidBy: "Alex",
		people: 4,
		mode: "Equal",
		status: "verified" as const,
	},
	{
		title: "Gas & tolls",
		total: 85.0,
		yourShare: 42.5,
		project: "Beach House",
		paidBy: "Jordan",
		people: 3,
		mode: "Shares",
		status: "pending" as const,
	},
	{
		title: "Dinner at Marea",
		total: 312.0,
		yourShare: 78.0,
		project: null as string | null,
		paidBy: "Sam",
		people: 4,
		mode: "Equal",
		status: "verified" as const,
	},
];

const DIFFERENTIATORS = [
	{
		icon: Users,
		title: "One Balance Per Person",
		description:
			"All debts with someone collapse into a single number. Split across trips, share a one-off dinner, settle when you want. No per-group accounting.",
	},
	{
		icon: Link2,
		title: "No Account Needed",
		description:
			"Send a magic link. They join with a name and email. No download, no password. If they sign up later, their history carries over.",
	},
	{
		icon: FolderKanban,
		title: "Projects for Everything",
		description:
			"Trips, roommates, group gifts, recurring costs. Five types with budgets, billing periods, and activity feeds. Or skip the project and split directly.",
	},
	{
		icon: CreditCard,
		title: "60+ Payment Methods",
		description:
			"Venmo, PayPal, Zelle, PIX, MercadoPago, crypto wallets, bank transfers. Shows methods you both use and generates deep links with the amount pre-filled.",
	},
];

const NET_BALANCE = BALANCES.reduce((sum, p) => sum + p.amount, 0);
const TOTAL_SPENT = RECENT_SPLITS.reduce((sum, s) => sum + s.total, 0);

export function DemoSplitting() {
	return (
		<div className="space-y-8">
			{/* Project context */}
			<div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
						<Plane className="h-4 w-4 text-amber-500" />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<p className="font-semibold text-sm">
								Beach House Weekend
							</p>
							<Badge
								className="px-1.5 py-0 text-[10px]"
								variant="secondary"
							>
								Trip
							</Badge>
						</div>
						<p className="text-muted-foreground text-xs">
							Mar 14-17 &middot; 4 people &middot; $
							{TOTAL_SPENT.toFixed(0)} spent
						</p>
					</div>
				</div>
				<div className="hidden items-center gap-1.5 sm:flex">
					{["A", "J", "S", "M"].map((initial) => (
						<div
							className="flex h-7 w-7 items-center justify-center rounded-full bg-muted font-medium text-[10px]"
							key={initial}
						>
							{initial}
						</div>
					))}
				</div>
			</div>

			{/* Balances + recent splits */}
			<div className="grid gap-6 lg:grid-cols-5">
				<Card className="border bg-card lg:col-span-2">
					<CardContent className="p-5">
						<h3 className="mb-4 font-semibold text-sm tracking-tight">
							Your Balances
						</h3>
						<div className="space-y-3">
							{BALANCES.map((person) => {
								const owesYou = person.amount > 0;
								return (
									<div
										className="flex items-center gap-3"
										key={person.name}
									>
										<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-xs">
											{person.name[0]}
										</div>
										<div className="min-w-0 flex-1">
											<p className="font-medium text-sm">
												{person.name}
											</p>
											<p className="text-muted-foreground text-xs">
												{owesYou
													? "owes you"
													: "you owe"}
											</p>
										</div>
										<span
											className={cn(
												"font-mono font-semibold text-sm",
												owesYou
													? "text-emerald-500"
													: "text-amber-500",
											)}
										>
											$
											{Math.abs(person.amount).toFixed(2)}
										</span>
									</div>
								);
							})}
						</div>
						<div className="mt-4 flex items-center justify-between border-t pt-3">
							<span className="text-muted-foreground text-xs">
								Net balance
							</span>
							<span className="font-mono font-semibold text-emerald-500 text-sm">
								+${NET_BALANCE.toFixed(2)}
							</span>
						</div>
					</CardContent>
				</Card>

				<Card className="border bg-card lg:col-span-3">
					<CardContent className="p-5">
						<h3 className="mb-4 font-semibold text-sm tracking-tight">
							Recent Splits
						</h3>
						<div className="space-y-3">
							{RECENT_SPLITS.map((split) => (
								<div
									className="flex items-center gap-3"
									key={split.title}
								>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-1.5">
											<p className="font-medium text-sm">
												{split.title}
											</p>
											{split.project && (
												<Badge
													className="px-1.5 py-0 text-[10px]"
													variant="secondary"
												>
													{split.project}
												</Badge>
											)}
											<Badge
												className={cn(
													"px-1.5 py-0 text-[10px] border-0",
													split.status === "verified"
														? "bg-emerald-500/10 text-emerald-500"
														: "bg-amber-500/10 text-amber-500",
												)}
												variant="outline"
											>
												{split.status === "verified"
													? "Verified"
													: "Pending"}
											</Badge>
										</div>
										<p className="text-muted-foreground text-xs">
											${split.total.toFixed(2)}{" "}
											&middot; {split.mode} &middot;{" "}
											{split.people} people &middot; paid
											by {split.paidBy}
										</p>
									</div>
									<div className="shrink-0 text-right">
										<p className="font-mono font-medium text-sm">
											${split.yourShare.toFixed(2)}
										</p>
										<p className="text-muted-foreground text-[10px]">
											your share
										</p>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Differentiator cards */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{DIFFERENTIATORS.map((d) => (
					<Card
						className="border border-border bg-card"
						key={d.title}
					>
						<CardContent className="p-5">
							<div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
								<d.icon className="h-4 w-4 text-muted-foreground" />
							</div>
							<h3 className="font-semibold text-sm">
								{d.title}
							</h3>
							<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
								{d.description}
							</p>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}

import {
	ArrowLeftRight,
	FileText,
	Gauge,
	Github,
	Globe,
	Lock,
	Repeat,
	TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

const FEATURES = [
	{
		icon: ArrowLeftRight,
		title: "Multi-Currency, Done Right",
		description:
			"Log expenses in any currency, crypto included. Parallel market rates like Argentina's blue dollar or Bolivia's parallel rate are supported. You pick the rate that applies.",
	},
	{
		icon: FileText,
		title: "Bank Import",
		description:
			"Drop in a CSV, PDF, or XLSX from your bank. AI handles the parsing and categorization.",
	},
	{
		icon: Lock,
		title: "Privacy Mode",
		description:
			"One toggle hides all amounts. Good for reviewing finances without flashing numbers in public.",
	},
	{
		icon: Gauge,
		title: "Budget Pacing",
		description:
			"Know your daily safe-to-spend the moment you open the app.",
	},
	{
		icon: Repeat,
		title: "Recurring Detection",
		description:
			"Subscriptions and fixed expenses are tracked automatically, so your recurring costs are always reflected in your budget.",
	},
	{
		icon: TrendingUp,
		title: "Wealth Tracking",
		description:
			"Track assets, liabilities, and net worth over time. See your financial runway at a glance.",
	},
];

export function FeatureHighlights() {
	return (
		<section className="py-16 lg:py-24">
			<div className="mx-auto max-w-6xl px-4">
				<div className="mb-10 text-center">
					<h2 className="font-bold text-3xl tracking-tight">
						Everything You Need
					</h2>
					<p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
						Built for people who want full control over their financial data.
					</p>
				</div>

				{/* Hero cards */}
				<div className="mb-4 grid gap-4 sm:grid-cols-2">
					{/* Free hosted instance */}
					<Card className="relative overflow-hidden border border-primary/20 bg-primary/5 shadow-sm dark:bg-primary/10">
						<CardContent className="flex h-full flex-col p-6">
							<div className="flex items-start justify-between">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
									<Globe className="h-5 w-5 text-primary" />
								</div>
								<span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs">
									No setup required
								</span>
							</div>
							<h3 className="mt-4 font-bold text-xl tracking-tight">
								Try it for Free
							</h3>
							<p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">
								A free hosted instance is available. Sign up and start tracking
								in minutes, no credit card needed.
							</p>
							<div className="mt-6">
								<Button asChild size="sm">
									<Link href="/signup">Get Started Free</Link>
								</Button>
							</div>
						</CardContent>
					</Card>

					{/* Open source */}
					<Card className="relative overflow-hidden border border-border bg-card shadow-sm">
						<CardContent className="flex h-full flex-col p-6">
							<div className="flex items-start justify-between">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
									<Github className="h-5 w-5 text-foreground" />
								</div>
								<span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-600 text-xs dark:text-emerald-400">
									100% Open Source
								</span>
							</div>
							<h3 className="mt-4 font-bold text-xl tracking-tight">
								Free &amp; Open Source
							</h3>
							<p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">
								Retrospend is fully open source. Read the code, contribute, or
								fork it. No vendor lock-in, no black boxes.
							</p>
							<div className="mt-6">
								<Button asChild size="sm" variant="outline">
									<Link
										href="https://github.com/syntheit/retrospend"
										target="_blank"
									>
										<Github className="mr-2 h-4 w-4" />
										View on GitHub
									</Link>
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>

				{/* Feature grid */}
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{FEATURES.map((feature) => (
						<Card
							className="border border-border bg-card shadow-sm"
							key={feature.title}
						>
							<CardContent className="p-6">
								<div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
									<feature.icon className="h-4 w-4 text-muted-foreground" />
								</div>
								<h3 className="font-semibold text-base">{feature.title}</h3>
								<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
									{feature.description}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	);
}

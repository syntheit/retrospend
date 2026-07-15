import {
	ArrowLeftRight,
	FileText,
	Gauge,
	Github,
	Globe,
	Lock,
	Repeat,
	Server,
	TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

type FeatureKey =
	| "multiCurrency"
	| "bankImport"
	| "privacyMode"
	| "budgetPacing"
	| "recurringExpenses"
	| "wealthTracking";

const FEATURES: { icon: typeof ArrowLeftRight; key: FeatureKey }[] = [
	{ icon: ArrowLeftRight, key: "multiCurrency" },
	{ icon: FileText, key: "bankImport" },
	{ icon: Lock, key: "privacyMode" },
	{ icon: Gauge, key: "budgetPacing" },
	{ icon: Repeat, key: "recurringExpenses" },
	{ icon: TrendingUp, key: "wealthTracking" },
];

export function FeatureHighlights() {
	const t = useTranslations("landing");

	return (
		<section className="py-16 lg:py-24">
			<div className="mx-auto max-w-6xl px-4">
				<div className="mb-10 text-center">
					<h2 className="font-bold text-3xl tracking-tight">
						{t("moreTitle")}
					</h2>
					<p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
						{t("moreSubtitle")}
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
									{t("noSetupRequired")}
								</span>
							</div>
							<h3 className="mt-4 font-bold text-xl tracking-tight">
								{t("tryForFreeTitle")}
							</h3>
							<p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">
								{t("tryForFreeDescription")}
							</p>
							<div className="mt-6">
								<Button asChild size="sm">
									<Link href="/signup">{t("getStartedFree")}</Link>
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
									{t("openSourceBadge")}
								</span>
							</div>
							<h3 className="mt-4 font-bold text-xl tracking-tight">
								{t("openSourceTitle")}
							</h3>
							<p className="mt-2 flex-1 text-muted-foreground text-sm leading-relaxed">
								{t("openSourceDescription")}
							</p>
							<div className="mt-6 flex flex-wrap gap-2">
								<Button asChild size="sm" variant="outline">
									<Link
										href="https://github.com/syntheit/retrospend"
										target="_blank"
									>
										<Github className="mr-2 h-4 w-4" />
										{t("viewOnGitHub")}
									</Link>
								</Button>
								<Button asChild size="sm" variant="ghost">
									<Link href="/docs/self-hosting?from=site">
										<Server className="mr-2 h-4 w-4" />
										{t("selfHost")}
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
							key={feature.key}
						>
							<CardContent className="p-6">
								<div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
									<feature.icon className="h-4 w-4 text-muted-foreground" />
								</div>
								<h3 className="font-semibold text-base">{t(`feature.${feature.key}.title`)}</h3>
								<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
									{t(`feature.${feature.key}.description`)}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		</section>
	);
}

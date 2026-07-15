"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { CtaSection } from "./cta-section";
import { FeatureHighlights } from "./feature-highlights";
import { FeatureSection } from "./feature-section";
import { HeroSection } from "./hero-section";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";

// Dynamic imports with ssr: false to prevent hydration mismatches
// from useId() in ChartContainer and date-dependent rendering
const DemoDashboardOverview = dynamic(
	() =>
		import("./demo-dashboard-overview").then((mod) => ({
			default: mod.DemoDashboardOverview,
		})),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[600px] w-full rounded-xl" />,
	},
);

const DemoBudget = dynamic(
	() => import("./demo-budget").then((mod) => ({ default: mod.DemoBudget })),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
	},
);

const DemoSplitting = dynamic(
	() =>
		import("./demo-splitting").then((mod) => ({
			default: mod.DemoSplitting,
		})),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
	},
);

const DemoWealth = dynamic(
	() => import("./demo-wealth").then((mod) => ({ default: mod.DemoWealth })),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[500px] w-full rounded-xl" />,
	},
);

export function LandingPage({ showLegalLinks }: { showLegalLinks: boolean }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const t = useTranslations("landing");

	return (
		<div className="dark h-svh overflow-y-auto" ref={scrollRef}>
			<a
				className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
				href="#main-content"
			>
				Skip to main content
			</a>
			<LandingHeader scrollContainerRef={scrollRef} />

			<main id="main-content">
				<HeroSection />

				<FeatureSection
					className="bg-accent/20"
					description={t("overviewDescription")}
					id="overview"
					title={t("overviewTitle")}
				>
					<DemoDashboardOverview />
				</FeatureSection>

				<FeatureSection
					description={t("budgetDescription")}
					id="budgets"
					title={t("budgetTitle")}
				>
					<DemoBudget />
				</FeatureSection>

				<FeatureSection
					className="bg-accent/20"
					description={t("splittingDescription")}
					id="splitting"
					title={t("splittingTitle")}
				>
					<DemoSplitting />
				</FeatureSection>

				<FeatureSection
					description={t("wealthDescription")}
					id="wealth"
					title={t("wealthTitle")}
				>
					<DemoWealth />
				</FeatureSection>

				<FeatureHighlights />
				<CtaSection />
			</main>

			<LandingFooter showLegalLinks={showLegalLinks} />
		</div>
	);
}

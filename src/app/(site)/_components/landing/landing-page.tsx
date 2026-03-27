"use client";

import dynamic from "next/dynamic";
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
					description="Real-time spending stats, budget pacing, category breakdowns, and recent activity. All on one screen."
					id="overview"
					title="Dashboard Overview"
				>
					<DemoDashboardOverview />
				</FeatureSection>

				<FeatureSection
					description="Allocate budgets across categories and track spending progress in real time."
					id="budgets"
					title="Budget Management"
				>
					<DemoBudget />
				</FeatureSection>

				<FeatureSection
					className="bg-accent/20"
					description="Split with anyone, no account required. One balance per person across all your shared expenses."
					id="splitting"
					title="Bill Splitting"
				>
					<DemoSplitting />
				</FeatureSection>

				<FeatureSection
					description="Track your net worth, assets, liabilities, and financial runway over time."
					id="wealth"
					title="Wealth Tracking"
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

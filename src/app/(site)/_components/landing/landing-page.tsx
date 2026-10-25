"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { ProductShot } from "../product-shot";
import { CtaSection } from "./cta-section";
import { FeatureHighlights } from "./feature-highlights";
import { FeatureSection } from "./feature-section";
import { HeroSection } from "./hero-section";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";

export function LandingPage({ showLegalLinks }: { showLegalLinks: boolean }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const t = useTranslations("landing");

	return (
		<div className="dark h-svh overflow-y-auto" ref={scrollRef}>
			<a
				className="focus:bg-background focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2"
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
					<ProductShot name="home" />
				</FeatureSection>

				<FeatureSection
					description={t("budgetDescription")}
					id="budgets"
					title={t("budgetTitle")}
				>
					<ProductShot name="budget" />
				</FeatureSection>

				<FeatureSection
					className="bg-accent/20"
					description={t("splittingDescription")}
					id="splitting"
					title={t("splittingTitle")}
				>
					<ProductShot name="people" />
				</FeatureSection>

				<FeatureSection
					description={t("wealthDescription")}
					id="wealth"
					title={t("wealthTitle")}
				>
					<ProductShot name="wealth" />
				</FeatureSection>

				<FeatureHighlights />
				<CtaSection />
			</main>

			<LandingFooter showLegalLinks={showLegalLinks} />
		</div>
	);
}

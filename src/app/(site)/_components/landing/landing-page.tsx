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
	const shell = useTranslations("shell");

	return (
		<div className="dark h-svh overflow-y-auto" ref={scrollRef}>
			<a
				className="rounded-ctl bg-surface text-fg text-body focus-visible:outline-brand focus:shadow-menu sr-only px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus-visible:outline-2"
				href="#main-content"
			>
				{shell("skipToContent")}
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

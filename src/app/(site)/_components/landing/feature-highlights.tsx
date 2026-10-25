import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";

type FeatureKey =
	| "multiCurrency"
	| "bankImport"
	| "privacyMode"
	| "budgetPacing"
	| "recurringExpenses"
	| "wealthTracking";

const FEATURES: FeatureKey[] = [
	"multiCurrency",
	"bankImport",
	"privacyMode",
	"budgetPacing",
	"recurringExpenses",
	"wealthTracking",
];

export function FeatureHighlights() {
	const t = useTranslations("landing");

	return (
		<section className="py-16 lg:py-24">
			<div className="mx-auto max-w-6xl px-4">
				<div className="mb-10 text-center">
					<h2 className="text-fg text-title">{t("moreTitle")}</h2>
					<p className="text-fg-2 text-body mx-auto mt-3 max-w-2xl">
						{t("moreSubtitle")}
					</p>
				</div>

				<div className="mb-12 grid gap-8 sm:grid-cols-2">
					<div className="flex flex-col">
						<h3 className="text-fg text-section">{t("tryForFreeTitle")}</h3>
						<p className="text-fg-2 text-body mt-2 flex-1">
							{t("tryForFreeDescription")}
						</p>
						<div className="mt-4">
							<Button asChild kind="primary">
								<Link href="/signup">{t("getStartedFree")}</Link>
							</Button>
						</div>
					</div>

					<div className="flex flex-col">
						<h3 className="text-fg text-section">{t("openSourceTitle")}</h3>
						<p className="text-fg-2 text-body mt-2 flex-1">
							{t("openSourceDescription")}
						</p>
						<div className="mt-4 flex flex-wrap gap-2">
							<Button asChild kind="secondary">
								<Link
									href="https://github.com/syntheit/retrospend"
									target="_blank"
								>
									{t("viewOnGitHub")}
								</Link>
							</Button>
							<Button asChild kind="ghost">
								<Link href="/docs/self-hosting?from=site">{t("selfHost")}</Link>
							</Button>
						</div>
					</div>
				</div>

				<div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
					{FEATURES.map((key) => (
						<div key={key}>
							<h3 className="text-fg text-body font-semibold">
								{t(`feature.${key}.title`)}
							</h3>
							<p className="text-fg-2 text-small mt-1">
								{t(`feature.${key}.description`)}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

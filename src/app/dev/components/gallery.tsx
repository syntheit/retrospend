"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useThemeContext } from "~/components/theme-provider";
import { Segmented } from "~/components/ui/segmented";
import { TooltipProvider } from "~/components/ui/tooltip";
import { m } from "./fixtures/rows";
import { CAP, SECTIONS } from "./sections";
import { MoneySection, PicksSection } from "./sections/atoms";
import { ChartSection } from "./sections/charts";
import { ButtonsSection, TooltipSection } from "./sections/controls";
import { EntitySections } from "./sections/entities";
import {
	FeedbackSection,
	MotionSection,
	RefreshSection,
} from "./sections/feedback";
import {
	AvatarSection,
	PageTabsSection,
	StructureSection,
} from "./sections/foundations";
import { GlanceSection, NeedsSection } from "./sections/home";
import {
	DateRangeSection,
	IdentitySection,
	MenuSection,
	MoneyInputSection,
	PickersSection,
	SheetSection,
} from "./sections/overlays";
import { TokensSection } from "./sections/tokens";
import { TransactionsSection } from "./sections/transactions";
import { Spec } from "./spec";

/** The data contract: what a figure carries, read off a rendered amount. */
function DataContract() {
	const rows: [string, string, string][] = [
		["Spent in October", "spent", "2706602"],
		["Owed to you", "owed.owedToYou", "1663643"],
		["Not planned yet", "budget.notPlannedYet", "850000"],
	];
	return (
		<Spec id="datacontract">
			<div className="max-w-105">
				{rows.map(([label, figure, amount]) => (
					<div
						className="border-line text-body flex min-h-8 items-center justify-between gap-6 border-t"
						key={figure}
					>
						<span className="text-fg-2">{label}</span>
						<span className="flex items-baseline gap-3">
							<code className="text-fg-3 text-meta font-mono">{figure}</code>
							<Money
								className="font-semibold"
								figure={figure}
								value={m(amount)}
							/>
						</span>
					</div>
				))}
			</div>
		</Spec>
	);
}

/**
 * The component gallery (S1 milestone 4): every registered component in
 * components.html order, desktop beside phone, on static fixtures. The owner
 * compares it with the mockup at checkpoint C1; visual regression runs on it.
 */
export function Gallery() {
	const t = useTranslations("gallery");
	const theme = useThemeContext();
	return (
		<TooltipProvider>
			<div className="bg-bg text-fg h-dvh overflow-y-auto">
				<main className="px-gutter mx-auto max-w-290 py-8">
					<header className="mb-4 flex flex-wrap items-start gap-4">
						<div className="min-w-0 flex-1">
							<h1 className="text-title">{t("title")}</h1>
							<p className="text-fg-3 text-small">{t("sub")}</p>
						</div>
						<Segmented
							label={t("theme")}
							onChange={(v) => theme.setTheme(v)}
							options={[
								{ value: "light", label: t("light") },
								{ value: "dark", label: t("dark") },
							]}
							value={theme.theme}
						/>
					</header>
					<p className="text-fg-2 text-body mb-2 max-w-160">{t("intro")}</p>
					<p className="text-fg-3 text-meta mb-6">{CAP.fixtures}</p>
					<nav
						aria-label={t("sections")}
						className="text-small mb-6 flex flex-wrap gap-x-4 gap-y-1"
					>
						{SECTIONS.map((s) => (
							<a
								className="text-fg-2 can-hover:hover:text-accent-strong can-hover:hover:underline"
								href={`#${s.id}`}
								key={s.id}
							>
								{s.nav}
							</a>
						))}
					</nav>
					<DataContract />
					<TokensSection />
					<RefreshSection />
					<MotionSection />
					<StructureSection />
					<AvatarSection />
					<PageTabsSection />
					<DateRangeSection />
					<IdentitySection />
					<GlanceSection />
					<NeedsSection />
					<TransactionsSection />
					<EntitySections />
					<MoneySection />
					<PicksSection />
					<ButtonsSection />
					<MenuSection />
					<SheetSection />
					<MoneyInputSection />
					<PickersSection />
					<ChartSection />
					<FeedbackSection />
					<Spec id="shell" />
					<Spec id="bottomnav" />
					<TooltipSection />
				</main>
			</div>
		</TooltipProvider>
	);
}

"use client";

import type { CompareReport, ScreenName } from "@retrospend/engine/device";
import { useTranslations } from "next-intl";
import type { ControllerState } from "~/lib/device-engine/controller";

/** The words for a report: any difference outranks a finished check. */
export function stateOf(report: CompareReport) {
	if (report.state === "checked" && report.differs.length > 0)
		return "mismatch";
	return report.state;
}

function Row({
	label,
	children,
	tone = "text-fg",
}: {
	label: string;
	children: string | number;
	tone?: string;
}) {
	return (
		<div className="border-line text-body flex min-h-8 items-center justify-between gap-6 border-t">
			<span className="text-fg-2">{label}</span>
			<span className={`${tone} tabular-nums`}>{children}</span>
		</div>
	);
}

/**
 * The last compare of each screen, as words and counts: how many figures were
 * held, which differ, what the device was behind on. A report's classes and
 * verdict parts hold no amounts, and this reads only the fields below, so none
 * can reach the page.
 */
export function CompareView({
	reports,
	lastPullAt,
	phase,
}: {
	reports: Partial<Record<ScreenName, CompareReport>>;
	/** Whether the engine is running at all: a check cannot start before it is. */
	phase: ControllerState;
	/** An ISO time, from the controller's clock. */
	lastPullAt: string | null;
}) {
	const t = useTranslations("deviceEngine");
	const held = Object.values(reports);
	return (
		<div>
			<Row label={t("engine")}>{t(`phases.${phase}`)}</Row>
			<Row label={t("lastPull")}>{lastPullAt ?? t("never")}</Row>
			{held.length === 0 && (
				<p className="text-fg-3 text-small mt-2">{t("none")}</p>
			)}
			{held.map((report) => {
				const state = stateOf(report);
				return (
					<section className="mt-6" key={report.screen}>
						<h2 className="text-body text-fg-2 mb-1">{report.screen}</h2>
						<Row
							label={t("state")}
							tone={state === "mismatch" ? "text-danger" : "text-fg"}
						>
							{t(`states.${state}`)}
						</Row>
						{report.skipped && <Row label={t("reason")}>{report.skipped}</Row>}
						<Row label={t("keys")}>
							{t("keysOf", { keys: report.keys, of: report.of })}
						</Row>
						<Row label={t("behind")}>{report.behind}</Row>
						<Row label={t("ratesMoved")}>{report.ratesMoved}</Row>
						<Row label={t("pulls")}>{report.generation}</Row>
						<Row label={t("zones")}>
							{report.zone === "same" ? t("same") : t("differ")}
						</Row>
						{report.differs.map((key) => (
							<Row key={key} label={key} tone="text-danger">
								{t("differs")}
							</Row>
						))}
					</section>
				);
			})}
		</div>
	);
}

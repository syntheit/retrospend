"use client";

import { useTranslations } from "next-intl";
import type { ControllerState } from "~/lib/device-engine/controller";
import type { ParityReport } from "~/lib/device-engine/protocol";

/** The words for a report: any difference outranks a finished check. */
export function stateOf(report: ParityReport) {
	if (report.state === "checked" && report.mismatchedIds.length > 0)
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
 * The last check of the glance figures, as words and counts: which figures
 * matched, how many lines each side holds. A report holds no amounts, and this
 * reads only the fields below, so none can reach the page.
 */
export function ParityView({
	report,
	lastPullAt,
	phase,
}: {
	report: ParityReport | null;
	/** Whether the engine is running at all: a check cannot start before it is. */
	phase: ControllerState;
	/** An ISO time, from the controller's clock. */
	lastPullAt: string | null;
}) {
	const t = useTranslations("deviceEngine");
	/** A count of lines in words, or an unknown marker (never a zero it did not read). */
	const lineText = (count: number | null | undefined) =>
		typeof count === "number" ? t("lineCount", { count }) : t("unknown");
	const engine = <Row label={t("engine")}>{t(`phases.${phase}`)}</Row>;
	if (!report)
		return (
			<div>
				{engine}
				<p className="text-fg-3 text-small mt-2">{t("none")}</p>
			</div>
		);
	const state = stateOf(report);
	const bad = state === "mismatch" || state === "failed";
	return (
		<div>
			{engine}
			<Row label={t("state")} tone={bad ? "text-danger" : "text-fg"}>
				{t(`states.${state}`)}
			</Row>
			<Row label={t("pulls")}>{report.generation}</Row>
			<Row label={t("lastPull")}>{lastPullAt ?? t("never")}</Row>
			<Row label={t("storedZone")}>{report.storedZone ?? t("unknown")}</Row>
			<Row label={t("browserZone")}>{report.browserZone ?? t("unknown")}</Row>
			<Row label={t("zones")}>
				{report.zoneDiffers ? t("differ") : t("same")}
			</Row>
			{report.ids.map((id) => {
				const count = report.counts.find((c) => c.id === id);
				const differs = report.mismatchedIds.includes(id);
				return (
					<Row key={id} label={id} tone={differs ? "text-danger" : "text-fg"}>
						{`${differs ? t("differs") : t("matches")}, ${t("lines", {
							device: lineText(count?.device),
							server: lineText(count?.server),
						})}`}
					</Row>
				);
			})}
		</div>
	);
}

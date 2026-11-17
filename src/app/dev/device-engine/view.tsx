"use client";

import { useTranslations } from "next-intl";
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
}: {
	report: ParityReport | null;
	/** An ISO time, from the controller's clock. */
	lastPullAt: string | null;
}) {
	const t = useTranslations("deviceEngine");
	if (!report) return <p className="text-fg-3 text-small">{t("none")}</p>;
	const state = stateOf(report);
	const bad = state === "mismatch" || state === "failed";
	return (
		<div>
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
							device: count?.device ?? 0,
							server: count?.server ?? 0,
						})}`}
					</Row>
				);
			})}
		</div>
	);
}

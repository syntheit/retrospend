"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Sheet } from "~/components/ui/sheet";
import type { RouterOutputs } from "~/trpc/react";
import { Facts, Stack } from "./feedback-facts";

export type ErrorReportItem =
	RouterOutputs["feedback"]["errorReports"]["items"][number];

/** One error report: where and when it happened, on which build, and its stack. */
export function ErrorReportSheet({
	item,
	onOpenChange,
	onDelete,
}: {
	item: ErrorReportItem;
	onOpenChange: (open: boolean) => void;
	onDelete: () => void;
}) {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
	const kinds = ["crash", "rejection", "render"] as const;
	const kind = kinds.find((k) => k === item.kind);
	const version = item.appVersion
		? item.build
			? t("versionBuild", { version: item.appVersion, build: item.build })
			: item.appVersion
		: null;
	return (
		<Sheet
			footer={
				<Button kind="ghost" onClick={onDelete}>
					{t("delete")}
				</Button>
			}
			onOpenChange={onOpenChange}
			open
			title={t("reportSheet")}
		>
			<div className="flex flex-col gap-6 pb-4">
				<p className="text-fg text-body break-words whitespace-pre-wrap">
					{item.message}
				</p>
				<Facts
					rows={[
						[t("kindLabel"), kind ? t(`kind.${kind}`) : item.kind],
						[t("from"), item.user.name],
						[
							t("occurred"),
							format.dateTime(item.occurredAt, {
								dateStyle: "medium",
								timeStyle: "short",
							}),
						],
						[
							t("sent"),
							format.dateTime(item.createdAt, {
								dateStyle: "medium",
								timeStyle: "short",
							}),
						],
						[t("screen"), item.screen],
						[t("version"), version],
						[t("platform"), item.os],
						[t("device"), item.device],
					]}
				/>
				{item.stack ? (
					<section className="flex flex-col gap-2">
						<h3 className="text-fg text-body font-semibold">{t("stack")}</h3>
						<Stack>{item.stack}</Stack>
					</section>
				) : null}
			</div>
		</Sheet>
	);
}

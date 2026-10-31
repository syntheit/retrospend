"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { formatBytes } from "~/lib/format";
import { api } from "~/trpc/react";

type Figure = {
	key: string;
	label: string;
	value: ReactNode;
	/** One quiet line under the figure. */
	meta?: string;
};

/**
 * The admin page at a glance: the server's figures as a flat definition
 * list. The label is small and quiet, the figure is title size with tabular
 * digits, so the numbers read apart from the words around them. No boxes
 * (R2, R3); the server computes every figure (admin.getOverview).
 */
export function AdminFigures() {
	const t = useTranslations("adminPage");
	const format = useFormatter();
	const { data } = api.admin.getOverview.useQuery(undefined, {
		refetchInterval: 60_000,
	});

	if (!data) {
		return (
			<div
				className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4"
				data-slot="admin-figures"
			>
				{Array.from({ length: 8 }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
					<Skeleton className="h-12 w-24" key={i} shape="line" />
				))}
			</div>
		);
	}

	const figures: Figure[] = [
		{ key: "users", label: t("users"), value: format.number(data.users) },
		{
			key: "active",
			label: t("activeThisWeek"),
			value: format.number(data.activeUsers),
		},
		{
			key: "expenses",
			label: t("expensesThisMonth"),
			value: format.number(data.expensesThisMonth),
		},
		{
			key: "storage",
			label: t("storage"),
			value: formatBytes(data.databaseBytes + data.mediaBytes),
			meta: t("storageDetail", {
				database: formatBytes(data.databaseBytes),
				media: formatBytes(data.mediaBytes),
			}),
		},
		{ key: "version", label: t("serverVersion"), value: data.version },
		{
			key: "feedback",
			label: t("unreadFeedback"),
			value: format.number(data.unreadFeedback),
		},
		{
			key: "errors",
			label: t("errorReports"),
			value: format.number(data.errorReports),
		},
		{
			key: "invites",
			label: t("invitesUsed"),
			value: format.number(data.invitesUsed),
			meta: t("invitesOpen", { count: data.invitesOpen }),
		},
	];

	return (
		<dl
			className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4"
			data-slot="admin-figures"
		>
			{figures.map((f) => (
				<div className="min-w-0" key={f.key}>
					<dt className="truncate text-fg-2 text-small">{f.label}</dt>
					<dd className="text-fg text-title tabular-nums">{f.value}</dd>
					{f.meta && (
						<dd className="truncate text-fg-3 text-meta">{f.meta}</dd>
					)}
				</div>
			))}
		</dl>
	);
}

"use client";

import { ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { formatDateOnly } from "~/lib/date";
import { api } from "~/trpc/react";
import { SectionShell } from "../section-shell";
import { SettingRow, SettingRows, TEXT_LINK } from "../setting-row";

type Kind = "expenses" | "budgets" | "wealth" | "all";

function save(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

const csv = (text: string) =>
	new Blob([text], { type: "text/csv;charset=utf-8;" });

/** The ZIP export arrives base64 encoded. */
function zip(base64: string) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new Blob([bytes], { type: "application/zip" });
}

/**
 * Data: the four exports today's Data card has (expenses, budgets and
 * wealth as CSV, everything as a ZIP), one Download each, and the way to
 * Import. Same calls and file names as today.
 */
export function DataSection() {
	const t = useTranslations("settingsV2.data");
	const toast = useToast();
	const expenses = api.expense.exportCsv.useMutation();
	const budgets = api.budget.exportCsv.useMutation();
	const wealth = api.wealth.exportCsv.useMutation();
	const all = api.exportData.allData.useMutation();
	const [busy, setBusy] = useState<Kind | null>(null);

	const run = async (kind: Kind) => {
		const day = formatDateOnly(new Date());
		setBusy(kind);
		try {
			if (kind === "expenses")
				save(csv((await expenses.mutateAsync({})).csv), `expenses-${day}.csv`);
			if (kind === "budgets")
				save(csv((await budgets.mutateAsync()).csv), `budgets-${day}.csv`);
			if (kind === "wealth")
				save(csv((await wealth.mutateAsync()).csv), `wealth-${day}.csv`);
			if (kind === "all") {
				const { zipData, filename } = await all.mutateAsync();
				save(zip(zipData), filename);
			}
			toast.saved(t(`done.${kind}`));
		} catch {
			toast.failed(t("failed"));
		} finally {
			setBusy(null);
		}
	};

	const row = (kind: Kind, format: "csv" | "zip") => (
		<SettingRow
			key={kind}
			label={t(`kinds.${kind}`)}
			meta={t(`formats.${format}`)}
		>
			<Button
				disabled={busy !== null && busy !== kind}
				kind="secondary"
				loading={busy === kind}
				onClick={() => void run(kind)}
				size="sm"
			>
				<Download aria-hidden="true" />
				{t("download")}
			</Button>
		</SettingRow>
	);

	return (
		<SectionShell id="data" title={t("title")}>
			<SettingRows>
				{row("expenses", "csv")}
				{row("budgets", "csv")}
				{row("wealth", "csv")}
				{row("all", "zip")}
				<SettingRow label={t("import")} meta={t("importMeta")}>
					<Link className={TEXT_LINK} href="/import">
						{t("openImport")}
						<ChevronRight aria-hidden="true" className="size-4" />
					</Link>
				</SettingRow>
			</SettingRows>
		</SectionShell>
	);
}

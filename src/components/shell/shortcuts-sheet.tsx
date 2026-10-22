"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { ADD_ACTIONS } from "~/lib/nav";

function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="flex shrink-0 items-center gap-1">
			{keys.map((k) => (
				<kbd
					className="inline-flex h-6 min-w-6 items-center justify-center rounded-ctl border border-line-strong bg-surface px-1 font-mono text-fg-2 text-meta"
					key={k}
				>
					{k}
				</kbd>
			))}
		</span>
	);
}

function useModKey(): string {
	const [mod, setMod] = useState("Ctrl");
	useEffect(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform ?? "")) setMod("⌘");
	}, []);
	return mod;
}

type Row = { id: string; label: string; keys: string[]; soon?: boolean };

/**
 * Keyboard shortcuts (account.html; opened with ?, the account menu and the
 * palette). The keys of the shell, then the table keys today's pages keep.
 */
export function ShortcutsSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("shell");
	const mod = useModKey();
	const groups: { id: string; title: string; rows: Row[] }[] = [
		{
			id: "global",
			title: t("shortcuts.global"),
			rows: [
				{ id: "palette", label: t("shortcuts.palette"), keys: [mod, "K"] },
				...ADD_ACTIONS.map((a) => ({
					id: a.id,
					label: t(`add.${a.id}`),
					keys: [a.key.toUpperCase()],
					soon: !a.ready,
				})),
				{ id: "close", label: t("shortcuts.close"), keys: ["Esc"] },
				{ id: "list", label: t("shortcuts.list"), keys: ["?"] },
			],
		},
		{
			id: "tables",
			title: t("shortcuts.tables"),
			rows: [
				{ id: "all", label: t("shortcuts.selectAll"), keys: [mod, "A"] },
				{ id: "range", label: t("shortcuts.range"), keys: ["Shift", "Click"] },
				{ id: "edit", label: t("shortcuts.edit"), keys: ["E", "Enter"] },
				{ id: "delete", label: t("shortcuts.delete"), keys: ["Delete"] },
				{ id: "clear", label: t("shortcuts.clear"), keys: ["Esc"] },
			],
		},
	];
	return (
		<ResponsiveDialog onOpenChange={onOpenChange} open={open}>
			<ResponsiveDialogContent className="gap-4 rounded-panel border-line bg-surface text-fg sm:max-w-md">
				<ResponsiveDialogHeader>
					<ResponsiveDialogTitle className="text-section">
						{t("shortcuts.title")}
					</ResponsiveDialogTitle>
				</ResponsiveDialogHeader>
				{groups.map((g) => (
					<section className="flex flex-col" key={g.id}>
						<h3 className="mb-1 text-fg-3 text-meta">{g.title}</h3>
						{g.rows.map((r) => (
							<div
								className="flex min-h-ctl items-center justify-between gap-3 border-line border-t py-1 text-body first-of-type:border-t-0"
								key={r.id}
							>
								<span className={r.soon ? "text-fg-3" : "text-fg"}>
									{r.label}
									{r.soon && (
										<span className="ml-2 text-meta">{t("add.comingSoon")}</span>
									)}
								</span>
								<Keys keys={r.keys} />
							</div>
						))}
					</section>
				))}
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}

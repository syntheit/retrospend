"use client";

import {
	Coins,
	Download,
	EllipsisIcon,
	Eye,
	EyeOff,
	FileUp,
	Plus,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BackButton } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useToast } from "~/components/ui/toast";
import { Tip } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { entryOf, hrefOf } from "~/lib/nav";
import { api } from "~/trpc/react";
import type { WealthView } from "./types";

/** Saves the server's CSV as a file. */
function download(csv: string, name: string) {
	const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Title, one sub line (when rates were updated, accounts without one), Add
 * account, and the overflow. Desktop keeps the eye button; phones put Hide
 * amounts in the menu (R28: at most two trailing buttons).
 */
export function WealthHeader({
	view,
	hidden,
	onToggleHidden,
	onAdd,
}: {
	view: WealthView;
	hidden: boolean;
	onToggleHidden: () => void;
	onAdd: () => void;
}) {
	const t = useTranslations("wealthPage");
	const nav = useTranslations("shell.nav");
	const toast = useToast();
	const phone = useIsMobile();
	const { short } = useRowDates();
	const exportCsv = api.wealth.exportCsv.useMutation();
	const updated = !view.ratesUpdated
		? null
		: view.ratesUpdated === view.today
			? t("ratesToday")
			: t("ratesOn", { date: short(view.ratesUpdated) });
	const sub = [
		updated,
		view.missingRates ? t("withoutRate", { count: view.missingRates }) : null,
	]
		.filter(Boolean)
		.join(" · ");
	const eyeLabel = hidden ? t("showAmounts") : t("hideAmounts");
	const EyeIcon = hidden ? EyeOff : Eye;
	const runExport = () =>
		exportCsv
			.mutateAsync()
			.then((r) => download(r.csv, "accounts.csv"))
			.catch(() => toast.failed(t("toast.failed")));
	const menu = (
		<DropdownMenu>
			<Tip content={t("more")}>
				<DropdownMenuTrigger asChild>
					<Button aria-label={t("more")} icon kind="ghost">
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
			</Tip>
			<DropdownMenuContent align="end">
				{phone ? (
					<>
						<DropdownMenuItem onSelect={onToggleHidden}>
							<EyeIcon aria-hidden="true" />
							{eyeLabel}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				) : null}
				<DropdownMenuItem asChild>
					<Link href="/currencies">
						<Coins aria-hidden="true" />
						{t("currencies")}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/import">
						<FileUp aria-hidden="true" />
						{t("importCsv")}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void runExport()}>
					<Download aria-hidden="true" />
					{t("exportCsv")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
	const eye = phone ? null : (
		<Tip content={eyeLabel}>
			<Button
				aria-label={eyeLabel}
				aria-pressed={hidden}
				icon
				kind="ghost"
				onClick={onToggleHidden}
			>
				<EyeIcon />
			</Button>
		</Tip>
	);
	const add = phone ? (
		<Tip content={t("addAccount")}>
			<Button aria-label={t("addAccount")} icon kind="ghost" onClick={onAdd}>
				<Plus />
			</Button>
		</Tip>
	) : (
		<Button kind="primary" onClick={onAdd}>
			<Plus />
			{t("addAccount")}
		</Button>
	);
	return (
		<>
			<PageHeader
				lead={
					<BackButton
						href={hrefOf(entryOf("home")) ?? "/"}
						label={nav("home")}
					/>
				}
				overflow={menu}
				primary={
					<>
						{eye}
						{add}
					</>
				}
				sub={sub || undefined}
				title={t("title")}
			/>
		</>
	);
}

"use client";

import {
	Banknote,
	Download,
	EllipsisIcon,
	FileText,
	Link2,
	Plus,
	User,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageHeader } from "~/components/layout/page-header";
import { useRowDates } from "~/components/rows/dates";
import { Face } from "~/components/ui/avatar-face";
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
import { firstName } from "~/features/people/filter";
import type { PersonPage } from "~/features/people/types";
import { BackButton, HeaderSub, PhoneSub } from "~/features/wealth/page-frame";
import { downloadCsv, downloadPdf } from "~/lib/format";
import { api } from "~/trpc/react";

/** "@lucia · Sharing since October · 12 expenses · 2 projects". */
export function usePersonSub(page: PersonPage) {
	const t = useTranslations("personPage.sub");
	const { month } = useRowDates();
	const p = page.person;
	return [
		p.onRetrospend
			? p.username
				? `@${p.username}`
				: null
			: t("notOnRetrospend"),
		page.stats.since ? t("since", { month: month(page.stats.since) }) : null,
		page.stats.expenses ? t("expenses", { count: page.stats.expenses }) : null,
		page.stats.projects ? t("projects", { count: page.stats.projects }) : null,
	]
		.filter(Boolean)
		.join(" · ");
}

/** Back to People, the face and name, Settle up, and the overflow (exports, invite). */
export function PersonHeader({
	page,
	onSettle,
}: {
	page: PersonPage;
	onSettle?: () => void;
}) {
	const t = useTranslations("personPage");
	const toast = useToast();
	const { openNewExpense } = useExpenseModal();
	const p = page.person;
	const who = { participantType: p.type, participantId: p.id };
	const history = api.exportData.exportPersonHistory.useMutation();
	const plan = api.exportData.exportPersonSettlementPlan.useMutation();
	const pdf = api.exportData.exportPersonPdf.useMutation();
	const invite = api.claim.generateLink.useMutation();
	const sub = usePersonSub(page);
	const fail = (e: unknown) =>
		toast.failed(e instanceof Error ? e.message : t("toast.failed"));
	const run = (job: () => Promise<unknown>) => () => void job().catch(fail);
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
				<DropdownMenuItem onSelect={() => openNewExpense()}>
					<Plus aria-hidden="true" />
					{t("addExpense", { name: firstName(p.name) })}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={run(async () => {
						const r = await history.mutateAsync({ ...who, format: "csv" });
						downloadCsv(r.csv, r.filename);
					})}
				>
					<Download aria-hidden="true" />
					{t("exportHistory")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={run(async () => {
						const r = await plan.mutateAsync({ ...who, format: "csv" });
						downloadCsv(r.csv, r.filename);
					})}
				>
					<Download aria-hidden="true" />
					{t("exportPlan")}
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={run(async () => {
						const r = await pdf.mutateAsync(who);
						downloadPdf(r.pdf, r.filename);
					})}
				>
					<FileText aria-hidden="true" />
					{t("statement")}
				</DropdownMenuItem>
				{p.type === "shadow" && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onSelect={run(async () => {
								const r = await invite.mutateAsync({ shadowId: p.id });
								await navigator.clipboard.writeText(r.url);
								toast.saved(t("toast.inviteCopied", { name: p.name }));
							})}
						>
							<Link2 aria-hidden="true" />
							{t("copyInvite")}
						</DropdownMenuItem>
					</>
				)}
				{p.onRetrospend && p.username && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem asChild>
							<Link href={`/u/${p.username}`}>
								<User aria-hidden="true" />
								{t("publicProfile")}
							</Link>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
	return (
		<>
			<PageHeader
				lead={
					<>
						<BackButton href="/people" label={t("back")} />
						<Face
							className="max-md:hidden"
							imageUrl={p.imageUrl}
							name={p.name}
							size="lg"
						/>
					</>
				}
				overflow={menu}
				primary={
					onSettle ? (
						<Button className="max-md:hidden" kind="primary" onClick={onSettle}>
							<Banknote />
							{t("settleUp")}
						</Button>
					) : undefined
				}
				sub={sub ? <HeaderSub text={sub} /> : undefined}
				title={p.name}
			/>
			<PhoneSub text={sub} />
		</>
	);
}

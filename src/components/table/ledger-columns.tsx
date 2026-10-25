"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";
import type { DataTableColumnDef } from "~/components/data-table-features";
import { Balance } from "~/components/money/balance";
import { Money } from "~/components/money/money";
import {
	TransactionAmount,
	TransactionLead,
} from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { FaceStack } from "~/components/ui/avatar-face";
import { selectColumn } from "./select-column";
import {
	actionsColumn,
	Title,
	TitleWords,
	useDateColumn,
} from "./transaction-columns";

/**
 * The column sets of a ledger inside one place (project.html, person.html):
 * - `project`: Title, Paid by, Split, Date, Total, Your share. A solo
 *   project keeps Title, Date and Total (nobody else paid or shares).
 * - `between`: Title, Paid by, Split, Date, Total, Between you, the effect
 *   of each row on your balance with that person.
 */
export type LedgerColumns = "project" | "between";

function Muted({ children }: { children: ReactNode }) {
	return <span className="text-fg-3 text-small">{children}</span>;
}

/** Your share of a row, or why there is none. */
function Share({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.table");
	if (tx.waiting === "review") return <Muted>{t("waitsForYou")}</Muted>;
	if (!tx.share) return <Muted>{t("none")}</Muted>;
	return <Money figure={tx.shareFigure} value={tx.share} />;
}

/** What a row does between you and them, or why it does nothing. */
function Between({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.table");
	const b = tx.between;
	if (!b) return null;
	if (b.paid && b.amount)
		return (
			<span className="text-fg-2 text-small whitespace-nowrap">
				{t(b.paid === "in" ? "paidYou" : "youPaid")}{" "}
				<Money figure={b.figure} value={b.amount} />
			</span>
		);
	if (b.state === "review") return <Muted>{t("waitsForYou")}</Muted>;
	if (b.state === "rejected") return <Muted>{t("rejected")}</Muted>;
	if (!b.amount) return <Muted>{t("noChange")}</Muted>;
	if (b.state === "settled")
		return (
			<span className="text-fg-3 text-small inline-flex items-center gap-1">
				<Lock aria-hidden="true" className="size-3" />
				{t.rich("wasSettled", {
					amount: () => <Money sign="never" value={b.amount} />,
				})}
			</span>
		);
	return <Balance amount={b.amount} figure={b.figure} />;
}

/** Who paid: "You", or their name. */
function PaidBy({ tx }: { tx: TransactionVM }) {
	const t = useTranslations("rows.table");
	if (tx.kind !== "expense") return null;
	return <span className="text-fg-2 truncate">{tx.payerName ?? t("you")}</span>;
}

export function useLedgerColumns({
	set,
	solo = false,
	selectable,
	hideDate = false,
	sortable = true,
	today,
	actions,
	onOpen,
}: {
	set: LedgerColumns;
	solo?: boolean;
	selectable: boolean;
	hideDate?: boolean;
	sortable?: boolean;
	today?: string;
	actions?: (tx: TransactionVM) => ReactNode;
	onOpen?: (tx: TransactionVM) => void;
}) {
	const t = useTranslations("rows.table");
	const date = useDateColumn(today, set === "between" ? "short" : "day");
	return useMemo(() => {
		const shared = set === "between" || !solo;
		const cols: DataTableColumnDef<TransactionVM>[] = [];
		if (selectable) cols.push(selectColumn());
		cols.push({
			id: "title",
			accessorKey: "title",
			header: t("title"),
			// The title takes the room left and truncates, so long titles never widen the table.
			meta: { flex: true, className: "w-full max-w-0" },
			cell: ({ row }) => {
				const tx = row.original;
				return (
					<span className="flex min-w-0 items-center gap-2">
						<TransactionLead size="sm" tx={tx} />
						<Title onOpen={onOpen} tx={tx} />
						{set === "between" && tx.project && (
							<span className="text-fg-3 text-meta max-w-40 shrink-0 truncate">
								{tx.project.name}
							</span>
						)}
						<TitleWords tx={tx} />
					</span>
				);
			},
		});
		if (shared)
			cols.push(
				{
					id: "paidBy",
					header: t("paidBy"),
					size: 120,
					enableSorting: false,
					cell: ({ row }) => <PaidBy tx={row.original} />,
				},
				{
					id: "split",
					header: t("split"),
					size: 120,
					enableSorting: false,
					cell: ({ row }) =>
						(row.original.people?.length ?? 0) > 1 ? (
							<FaceStack
								max={5}
								on="bg"
								payerId={row.original.payerId}
								people={row.original.people ?? []}
							/>
						) : null,
				},
			);
		if (!hideDate) cols.push(date);
		cols.push({
			id: "amount",
			accessorFn: (tx) => tx.sortKey ?? undefined,
			sortFn: "basic",
			sortUndefined: "last",
			header: t("total"),
			size: 140,
			meta: { className: "text-right", align: "right" },
			// A payment in a person's ledger has no total: Between you says it.
			cell: ({ row }) =>
				set === "between" && row.original.between?.paid ? null : (
					<span className="ml-auto">
						<TransactionAmount share={false} tx={row.original} />
					</span>
				),
		});
		if (set === "project" && !solo)
			cols.push({
				id: "share",
				header: t("yourShare"),
				size: 140,
				enableSorting: false,
				meta: { className: "text-right", align: "right" },
				cell: ({ row }) => (
					<span className="ml-auto">
						<Share tx={row.original} />
					</span>
				),
			});
		if (set === "between")
			cols.push({
				id: "between",
				header: t("between"),
				size: 170,
				enableSorting: false,
				meta: { className: "text-right", align: "right" },
				cell: ({ row }) => (
					<span className="ml-auto">
						<Between tx={row.original} />
					</span>
				),
			});
		if (actions) cols.push(actionsColumn(actions, t("actions")));
		if (!sortable) for (const c of cols) c.enableSorting = false;
		return cols;
	}, [set, solo, selectable, hideDate, sortable, actions, onOpen, t, date]);
}

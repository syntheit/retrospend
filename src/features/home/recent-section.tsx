"use client";

import { Plus, Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import { useEntryActions } from "~/features/entry/entry-actions";
import { Section } from "~/components/layout/section";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import {
	opens,
	toExpenseTarget,
	toTransactionVM,
} from "~/features/activity/to-vm";
import { useRowActions } from "~/features/activity/use-row-actions";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";
import { PartUnavailable } from "./home-states";

/**
 * Recent: the last five expenses as Activity shows them (its read and its
 * row actions: open, Edit, Duplicate, Delete with an Undo), then See all.
 */
export function RecentSection({
	rows,
	today,
	loading,
	failed,
	onRetry,
}: {
	rows: ActivityRowDTO[] | undefined;
	today: string | undefined;
	loading: boolean;
	failed: boolean;
	onRetry: () => void;
}) {
	const t = useTranslations("homePage.recent");
	const row = useTranslations("activity.row");
	const types = useTranslations("activity.rateTypes");
	const modal = useEntryActions();
	const { handlersFor, open } = useRowActions(rows ?? []);
	const has = !!rows?.length;

	let body: React.ReactNode;
	if (loading) body = <SkeletonRows count={5} />;
	else if (failed || !rows) body = <PartUnavailable onRetry={onRetry} />;
	else if (!has)
		body = (
			<Empty
				action={
					<Button
						kind="secondary"
						onClick={() => modal.openNewExpense()}
						size="sm"
					>
						<Plus aria-hidden="true" />
						{t("add")}
					</Button>
				}
				hint={t("emptyHint")}
				icon={Receipt}
				title={t("empty")}
			/>
		);
	else
		body = (
			<RowList label={t("title")}>
				{rows.map((r) => {
					const vm = toTransactionVM(
						r,
						(p) =>
							row(p.direction === "sent" ? "paidTo" : "paidYou", {
								name: p.counterparty,
							}),
						(type) =>
							row("rate", { type: types.has(type) ? types(type) : type }),
					);
					const target = toExpenseTarget(r, vm.title);
					const handlers = handlersFor(r);
					return (
						<ActionArea
							entity="expense"
							handlers={handlers}
							key={r.id}
							target={target}
						>
							<TransactionRow
								actions={
									<ActionMenu
										entity="expense"
										handlers={handlers}
										target={target}
									/>
								}
								data-id={r.id}
								onOpen={opens(r) ? () => open(r) : undefined}
								showDate
								today={today}
								tx={vm}
							/>
						</ActionArea>
					);
				})}
			</RowList>
		);

	return (
		<Section
			action={has ? { label: t("seeAll"), href: "/activity" } : undefined}
			id="recent"
			title={t("title")}
		>
			{body}
		</Section>
	);
}

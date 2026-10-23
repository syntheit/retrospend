"use client";

import { Banknote, Lock, Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import { Balance } from "~/components/money/balance";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { IconTile, Row, RowSub } from "~/components/rows/row";
import { FaceStack } from "~/components/ui/avatar-face";
import { CategoryTile } from "~/components/ui/category-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { firstName } from "~/features/people/filter";
import { useMethodName } from "~/features/people/method-name";
import type {
	LedgerRowDTO,
	PaymentDTO,
	PersonIdentityDTO,
} from "~/features/people/types";
import { paymentTargetOf, usePaymentActions } from "./use-payment-actions";

/** What an expense does between you: the effect, or why there is none. */
function Effect({ row }: { row: LedgerRowDTO }) {
	const t = useTranslations("personPage.ledger");
	if (row.state === "review")
		return <span className="text-fg-3 text-small">{t("waitsForYou")}</span>;
	if (row.state === "rejected")
		return <span className="text-fg-3 text-small">{t("rejected")}</span>;
	if (!row.effect)
		return <span className="text-fg-3 text-small">{t("noChange")}</span>;
	if (row.state === "settled")
		return (
			<span className="text-fg-3 text-small inline-flex items-center gap-1">
				<Lock aria-hidden="true" className="size-3" />
				{t.rich("wasSettled", {
					amount: () => <Money sign="never" value={row.effect} />,
				})}
			</span>
		);
	return <Balance amount={row.effect} className="text-small" />;
}

export function ExpenseRow({
	row,
	onOpen,
}: {
	row: LedgerRowDTO;
	onOpen?: () => void;
}) {
	const t = useTranslations("personPage.ledger");
	const { short } = useRowDates();
	const payer =
		row.paidBy === "me"
			? t("paidByYou")
			: t("paidBy", { name: firstName(row.payerName) });
	return (
		<Row
			data-row-kind="expense"
			end={
				<>
					<Effect row={row} />
					<span className="text-fg-3 text-meta whitespace-nowrap">
						{t.rich("of", { amount: () => <Money value={row.amount} /> })}
					</span>
				</>
			}
			lead={
				row.category ? (
					<CategoryTile category={row.category} />
				) : (
					<IconTile icon={Receipt} />
				)
			}
			open={onOpen ? { onOpen, label: row.title } : undefined}
			sub={
				<RowSub
					parts={[
						row.state === "review" && (
							<StatusDot kind="review" label={t("toReview")} size="sm" />
						),
						short(row.date),
						payer,
						row.project && { shrink: row.project.name },
						row.people.length > 1 && {
							keep: (
								<FaceStack payerId={row.payerId} people={[...row.people]} />
							),
						},
					]}
				/>
			}
			title={row.title}
		/>
	);
}

export function PaymentRow({
	payment,
	person,
}: {
	payment: PaymentDTO;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("personPage.ledger");
	const { short } = useRowDates();
	const methodName = useMethodName();
	const handlers = usePaymentActions(person.name)(payment);
	const target = paymentTargetOf(payment, person.name);
	const pending = payment.status === "pending";
	const waitsForMe = target.waitsForMe;
	return (
		<ActionArea entity="payment" handlers={handlers} target={target}>
			<Row
				actions={
					<ActionMenu entity="payment" handlers={handlers} target={target} />
				}
				data-row-kind="payment"
				end={<Money className="text-fg font-semibold" value={payment.amount} />}
				lead={<IconTile icon={Banknote} />}
				sub={
					<RowSub
						parts={[
							payment.method && methodName(payment.method),
							short(payment.paidOn),
							pending && (
								<StatusDot
									kind="pending"
									label={
										waitsForMe
											? t("waitsForYou")
											: t("waitingFor", { name: person.name })
									}
									size="sm"
								/>
							),
						]}
					/>
				}
				title={
					payment.direction === "in"
						? t("paidYou", { name: person.name })
						: t("youPaid", { name: person.name })
				}
			/>
		</ActionArea>
	);
}

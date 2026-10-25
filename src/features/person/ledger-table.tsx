"use client";

import { useTranslations } from "next-intl";
import { type ReactElement, useCallback, useMemo } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { TransactionVM } from "~/components/rows/types";
import { TransactionTable } from "~/components/table/transaction-table";
import { firstName } from "~/features/people/filter";
import type { PersonIdentityDTO } from "~/features/people/types";
import type { LedgerItem } from "./ledger-filter";
import { paymentTargetOf, usePaymentActions } from "./use-payment-actions";

const PAYMENT = "payment:";

/** A ledger item as the kit table's row; nothing computed (R9). */
function toVM(
	item: LedgerItem,
	person: PersonIdentityDTO,
	words: { paidYou: string; youPaid: string },
): TransactionVM {
	if (item.kind === "payment") {
		const p = item.payment;
		return {
			id: `${PAYMENT}${p.id}`,
			title: p.direction === "in" ? words.paidYou : words.youPaid,
			kind: "payment",
			category: null,
			amount: p.amount,
			reviewed: true,
			...(p.status === "pending" ? { pending: true } : {}),
			...(p.direction === "in" ? { payerName: firstName(person.name) } : {}),
			date: p.paidOn,
			between: { amount: p.amount, state: "ok", paid: p.direction },
		};
	}
	const r = item.row;
	return {
		id: r.id,
		title: r.title,
		kind: "expense",
		category: r.category,
		amount: r.amount,
		reviewed: true,
		...(r.state === "review" || r.state === "rejected"
			? { waiting: r.state }
			: {}),
		project: r.project,
		people: [...r.people],
		payerId: r.payerId,
		...(r.paidBy === "me" ? {} : { payerName: firstName(r.payerName) }),
		date: r.date,
		between: { amount: r.effect, state: r.state },
	};
}

/**
 * Between you on desktop (person.html): one table by month with Paid by,
 * Split, Date, Total and what each row does between you. A payment says
 * who paid whom and keeps its own menu (Confirm, Not received).
 */
export function LedgerTable({
	groups,
	person,
	heading,
	onOpen,
}: {
	groups: { month: string; items: LedgerItem[] }[];
	person: PersonIdentityDTO;
	heading: (month: string) => string;
	/** Opens an expense you can edit. */
	onOpen: (id: string) => void;
}) {
	const t = useTranslations("personPage.ledger");
	const handlersOf = usePaymentActions(person.name);
	const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
	const words = {
		paidYou: t("paidYou", { name: person.name }),
		youPaid: t("youPaid", { name: person.name }),
	};
	const rows = items.map((i) => toVM(i, person, words));
	const payments = useMemo(
		() =>
			new Map(
				items.flatMap((i) =>
					i.kind === "payment"
						? [[`${PAYMENT}${i.payment.id}`, i.payment]]
						: [],
				),
			),
		[items],
	);
	const editable = useMemo(
		() =>
			new Set(
				items.flatMap((i) =>
					i.kind === "expense" && i.row.canEdit ? [i.row.id] : [],
				),
			),
		[items],
	);
	const actions = useCallback(
		(tx: TransactionVM) => {
			const p = payments.get(tx.id);
			if (!p) return null;
			return (
				<ActionMenu
					entity="payment"
					handlers={handlersOf(p)}
					target={paymentTargetOf(p, person.name)}
				/>
			);
		},
		[payments, handlersOf, person.name],
	);
	const rowArea = useCallback(
		(tx: TransactionVM, tr: ReactElement) => {
			const p = payments.get(tx.id);
			if (!p) return tr;
			return (
				<ActionArea
					entity="payment"
					handlers={handlersOf(p)}
					key={tx.id}
					target={paymentTargetOf(p, person.name)}
				>
					{tr}
				</ActionArea>
			);
		},
		[payments, handlersOf, person.name],
	);
	return (
		<TransactionTable
			actions={actions}
			groups={{ by: "month", label: heading }}
			ledger="between"
			onOpen={(tx) => {
				if (editable.has(tx.id)) onOpen(tx.id);
			}}
			rowArea={rowArea}
			rows={rows}
			selectable={false}
		/>
	);
}

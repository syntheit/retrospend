"use client";

import { toMinorUnits } from "@retrospend/domain/money";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
	ExpenseModalContext,
	type ExpenseModalContextValue,
} from "~/components/expense-modal-provider";
import { EntrySheetsContext, type EntrySheets } from "./context";
import { ExpenseSheet } from "./expense/expense-sheet";
import { IncomeSheet } from "./income/income-sheet";
import { SharedEntrySheet } from "./read/shared-entry-sheet";
import { TransferSheet } from "./transfer/transfer-sheet";
import type { EntryRequest } from "./types";

type Open = { request: EntryRequest; key: number } | null;

/**
 * The Add family host for the v2 shell (4G). It answers the old expense
 * modal's context too, so every place that opened today's modal (Activity,
 * Projects, People, the old pages inside the new shell) opens these sheets.
 * One sheet at a time; each open mounts fresh state.
 */
export function EntrySheetsProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<Open>(null);
	const open = useCallback(
		(request: EntryRequest) =>
			setCurrent((c) => ({ request, key: (c?.key ?? 0) + 1 })),
		[],
	);
	const close = useCallback(() => setCurrent(null), []);
	const sheets = useMemo<EntrySheets>(() => ({ open, close }), [open, close]);

	const legacy = useMemo<ExpenseModalContextValue>(
		() => ({
			openNewExpense: (o) =>
				open({
					kind: "expense",
					mode: "create",
					projectId: o?.projectId,
					projectName: o?.projectName,
					projectCurrency: o?.projectDefaultCurrency,
				}),
			openExpense: (id) => open({ kind: "expense", mode: "edit", id }),
			openSharedExpense: (id) => open({ kind: "shared", id }),
			openDuplicateExpense: (s) =>
				open({
					kind: "expense",
					mode: "create",
					duplicate: true,
					prefill: {
						title: s.title,
						minor: toMinorUnits(s.amount, s.currency),
						currency: s.currency,
						categoryId: s.categoryId,
						description: s.description,
						location: s.location,
					},
				}),
			expenseId: null,
			isOpen: current !== null,
		}),
		[open, current],
	);

	return (
		<EntrySheetsContext value={sheets}>
			<ExpenseModalContext.Provider value={legacy}>
				{children}
				{current ? (
					<EntryHost
						key={current.key}
						onClose={close}
						onOpen={open}
						request={current.request}
					/>
				) : null}
			</ExpenseModalContext.Provider>
		</EntrySheetsContext>
	);
}

function EntryHost({
	request,
	onClose,
	onOpen,
}: {
	request: EntryRequest;
	onClose: () => void;
	onOpen: (r: EntryRequest) => void;
}) {
	switch (request.kind) {
		case "expense":
			return (
				<ExpenseSheet onClose={onClose} onOpen={onOpen} request={request} />
			);
		case "shared":
			return <SharedEntrySheet id={request.id} onClose={onClose} />;
		case "income":
			return <IncomeSheet accountId={request.accountId} onClose={onClose} />;
		case "transfer":
			return (
				<TransferSheet
					fromAccountId={request.fromAccountId}
					onClose={onClose}
				/>
			);
	}
}

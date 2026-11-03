"use client";

import { toMinorUnits } from "@retrospend/domain/money";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { type EntrySheets, EntrySheetsContext } from "./context";
import { usePaneRoute } from "./detail/pane-route";
import { type EntryActions, EntryActionsContext } from "./entry-actions";
import { EntryFrame } from "./entry-frame";
import { ExpenseSheet } from "./expense/expense-sheet";
import { IncomeSheet } from "./income/income-sheet";
import { SharedEntrySheet } from "./read/shared-entry-sheet";
import { TransferSheet } from "./transfer/transfer-sheet";
import type { EntryCarry, EntryMode, EntryRequest } from "./types";

type Open = { request: EntryRequest; key: number } | null;

/**
 * The Add family host. It answers the page-level actions too (EntryActions),
 * so Activity, Projects, People and the palette open these sheets with a
 * plain call. One sheet at a time; each open mounts fresh state.
 */
export function EntrySheetsProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<Open>(null);
	const open = useCallback(
		(request: EntryRequest) =>
			setCurrent((c) => ({ request, key: (c?.key ?? 0) + 1 })),
		[],
	);
	// Same sheet, another mode: the key stays, so nothing else resets.
	const swap = useCallback(
		(request: EntryRequest) => setCurrent((c) => (c ? { ...c, request } : c)),
		[],
	);
	const close = useCallback(() => setCurrent(null), []);
	const pane = usePaneRoute();
	const sheets = useMemo<EntrySheets>(() => ({ open, close }), [open, close]);

	const actions = useMemo<EntryActions>(
		() => ({
			openNewExpense: (o) =>
				open({
					kind: "expense",
					mode: "create",
					projectId: o?.projectId,
					projectName: o?.projectName,
					projectCurrency: o?.projectDefaultCurrency,
				}),
			openExpense: (id) => pane.open({ kind: "personal", id }),
			openSharedExpense: (id) => pane.open({ kind: "shared", id }),
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
			expenseId: pane.target?.id ?? null,
			isOpen: current !== null,
		}),
		[open, current, pane],
	);

	return (
		<EntrySheetsContext value={sheets}>
			<EntryActionsContext.Provider value={actions}>
				{children}
				{current ? (
					<EntryHost
						key={current.key}
						onClose={close}
						onMode={(mode, carry) => swap(requestFor(mode, carry))}
						onOpen={open}
						request={current.request}
					/>
				) : null}
			</EntryActionsContext.Provider>
		</EntrySheetsContext>
	);
}

/** The request for a mode, starting from what carries over. */
function requestFor(mode: EntryMode, carry: EntryCarry): EntryRequest {
	switch (mode) {
		case "expense":
			return {
				kind: "expense",
				mode: "create",
				prefill: {
					minor: carry.minor,
					currency: carry.currency,
					date: carry.date,
					description: carry.note,
				},
			};
		case "income":
			return { kind: "income", carry };
		case "transfer":
			return { kind: "transfer", carry };
	}
}

function EntryHost({
	request,
	onClose,
	onOpen,
	onMode,
}: {
	request: EntryRequest;
	onClose: () => void;
	onOpen: (r: EntryRequest) => void;
	onMode: (mode: EntryMode, carry: EntryCarry) => void;
}) {
	if (request.kind === "shared")
		return (
			<SharedEntrySheet
				id={request.id}
				onClose={onClose}
				start={request.start}
			/>
		);
	// One frame for the three modes: it stays mounted while the mode changes.
	return (
		<EntryFrame>
			{request.kind === "expense" ? (
				<ExpenseSheet
					onClose={onClose}
					onMode={onMode}
					onOpen={onOpen}
					request={request}
				/>
			) : request.kind === "income" ? (
				<IncomeSheet
					accountId={request.accountId}
					carry={request.carry}
					onClose={onClose}
					onMode={onMode}
				/>
			) : (
				<TransferSheet
					carry={request.carry}
					fromAccountId={request.fromAccountId}
					onClose={onClose}
					onMode={onMode}
				/>
			)}
		</EntryFrame>
	);
}

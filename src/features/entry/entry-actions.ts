"use client";

import { createContext, useContext } from "react";

export type OpenNewExpenseOptions = {
	projectId?: string;
	projectName?: string;
	projectDefaultCurrency?: string;
	isSolo?: boolean;
};

/** An expense to start a new one from. */
export type DuplicateSource = {
	title?: string | null;
	amount: number;
	currency: string;
	categoryId?: string | null;
	description?: string | null;
	location?: string | null;
};

/**
 * What a page can ask the Add and Edit sheets to open (EntrySheetsProvider
 * answers). Pages that only need to open an expense read this; the sheets'
 * own context (./context) carries the full request.
 */
export type EntryActions = {
	openNewExpense: (options?: OpenNewExpenseOptions) => void;
	openExpense: (id: string) => void;
	openSharedExpense: (sharedTransactionId: string) => void;
	openDuplicateExpense: (source: DuplicateSource) => void;
	expenseId: string | null;
	isOpen: boolean;
};

export const EntryActionsContext = createContext<EntryActions | undefined>(
	undefined,
);

export function useEntryActions() {
	const context = useContext(EntryActionsContext);
	if (!context) {
		throw new Error("useEntryActions must be used within EntrySheetsProvider");
	}
	return context;
}

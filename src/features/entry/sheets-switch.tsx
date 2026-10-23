"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { ExpenseModalProvider } from "~/components/expense-modal-provider";
import { useShellMode } from "~/components/shell/shell-context";

// Loaded only for viewers with the new shell, so legacy pages do not ship it.
const EntrySheetsProvider = dynamic(() =>
	import("./provider").then((m) => m.EntrySheetsProvider),
);

/**
 * The uiV2 switch for every Add and Edit expense entry point: the new shell
 * gets the Add family sheets, the old one today's expense modal unchanged.
 */
export function ExpenseSheetsSwitch({ children }: { children: ReactNode }) {
	const mode = useShellMode();
	if (mode === "v2")
		return <EntrySheetsProvider>{children}</EntrySheetsProvider>;
	return <ExpenseModalProvider>{children}</ExpenseModalProvider>;
}

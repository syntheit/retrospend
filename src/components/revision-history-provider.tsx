"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { RevisionHistoryDrawer } from "~/components/revision-history-drawer";

type RevisionHistoryContextValue = {
	openHistory: (transactionId: string) => void;
	closeHistory: () => void;
};

const RevisionHistoryContext = createContext<
	RevisionHistoryContextValue | undefined
>(undefined);

export function RevisionHistoryProvider({ children }: { children: ReactNode }) {
	const [transactionId, setTransactionId] = useState<string | null>(null);

	const openHistory = useCallback((id: string) => setTransactionId(id), []);
	const closeHistory = useCallback(() => setTransactionId(null), []);

	const value = useMemo(
		() => ({ openHistory, closeHistory }),
		[openHistory, closeHistory],
	);

	return (
		<RevisionHistoryContext.Provider value={value}>
			{children}
			<RevisionHistoryDrawer
				onClose={closeHistory}
				transactionId={transactionId}
			/>
		</RevisionHistoryContext.Provider>
	);
}

export function useRevisionHistory() {
	const context = useContext(RevisionHistoryContext);
	if (!context) {
		throw new Error(
			"useRevisionHistory must be used within RevisionHistoryProvider",
		);
	}
	return context;
}

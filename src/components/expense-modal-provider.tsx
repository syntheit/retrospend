"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

import { ExpenseModal } from "~/components/expense-modal";
import { generateId } from "~/lib/utils";

type ExpenseModalContextValue = {
	openNewExpense: () => void;
	openExpense: (id: string) => void;
	expenseId: string | null;
	isOpen: boolean;
};

const ExpenseModalContext = createContext<ExpenseModalContextValue | undefined>(
	undefined,
);

export function ExpenseModalProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<{
		open: boolean;
		expenseId: string | null;
		mode: "create" | "edit";
	}>({
		open: false,
		expenseId: null,
		mode: "create",
	});

	const openNewExpense = useCallback(() => {
		const expenseId = generateId();
		setState({ open: true, expenseId, mode: "create" });
	}, []);

	const openExpense = useCallback((id: string) => {
		setState({ open: true, expenseId: id, mode: "edit" });
	}, []);

	const handleOpenChange = useCallback((nextOpen: boolean) => {
		setState((prev) => ({ ...prev, open: nextOpen }));
	}, []);

	const value = useMemo(
		() => ({
			openNewExpense,
			openExpense,
			expenseId: state.expenseId,
			isOpen: state.open,
		}),
		[openNewExpense, openExpense, state.expenseId, state.open],
	);

	return (
		<ExpenseModalContext.Provider value={value}>
			{children}
			{state.expenseId ? (
				<ExpenseModal
					description={
						state.mode === "create"
							? "Fill in the details for your expense."
							: "Update the details of your expense."
					}
					expenseId={state.expenseId}
					onOpenChange={handleOpenChange}
					open={state.open}
					title={state.mode === "create" ? "New Expense" : "Edit Expense"}
				/>
			) : null}
		</ExpenseModalContext.Provider>
	);
}

export function useExpenseModal() {
	const context = useContext(ExpenseModalContext);
	if (!context) {
		throw new Error("useExpenseModal must be used within ExpenseModalProvider");
	}
	return context;
}

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
import type { ExpenseInitialValues } from "~/hooks/use-expense-form";
import { generateId } from "~/lib/utils";

type OpenNewExpenseOptions = {
	projectId?: string;
	projectName?: string;
	projectDefaultCurrency?: string;
	isSolo?: boolean;
};

type ExpenseModalContextValue = {
	openNewExpense: (options?: OpenNewExpenseOptions) => void;
	openExpense: (id: string) => void;
	openSharedExpense: (sharedTransactionId: string) => void;
	openDuplicateExpense: (source: ExpenseInitialValues) => void;
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
		sharedTransactionId?: string;
		mode: "create" | "edit";
		projectId?: string;
		projectName?: string;
		projectDefaultCurrency?: string;
		isSolo?: boolean;
		initialValues?: ExpenseInitialValues;
		stickyDefaults?: { currency?: string };
	}>({
		open: false,
		expenseId: null,
		mode: "create",
	});

	const openNewExpense = useCallback((options?: OpenNewExpenseOptions) => {
		const expenseId = generateId();
		setState({
			open: true,
			expenseId,
			mode: "create",
			projectId: options?.projectId,
			projectName: options?.projectName,
			projectDefaultCurrency: options?.projectDefaultCurrency,
			isSolo: options?.isSolo,
		});
	}, []);

	const openExpense = useCallback((id: string) => {
		setState({ open: true, expenseId: id, mode: "edit" });
	}, []);

	const openSharedExpense = useCallback((sharedTransactionId: string) => {
		setState({ open: true, expenseId: sharedTransactionId, sharedTransactionId, mode: "edit" });
	}, []);

	const openDuplicateExpense = useCallback((source: ExpenseInitialValues) => {
		setState({
			open: true,
			expenseId: generateId(),
			mode: "create",
			initialValues: source,
		});
	}, []);

	const handleOpenChange = useCallback((nextOpen: boolean) => {
		setState((prev) => ({ ...prev, open: nextOpen }));
	}, []);

	/** Called by the form after "Save & Add Another" succeeds. */
	const resetForNew = useCallback(() => {
		setState((prev) => ({
			...prev,
			expenseId: generateId(),
			mode: "create",
			initialValues: undefined,
			// Carry forward the currency from the current context
			stickyDefaults: { currency: prev.projectDefaultCurrency },
		}));
	}, []);

	const value = useMemo(
		() => ({
			openNewExpense,
			openExpense,
			openSharedExpense,
			openDuplicateExpense,
			expenseId: state.expenseId,
			isOpen: state.open,
		}),
		[openNewExpense, openExpense, openSharedExpense, openDuplicateExpense, state.expenseId, state.open],
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
					sharedTransactionId={state.sharedTransactionId}
					isSolo={state.isSolo}
					mode={state.mode}
					onOpenChange={handleOpenChange}
					onSaveAndNew={resetForNew}
					open={state.open}
					projectId={state.projectId}
					projectDefaultCurrency={state.projectDefaultCurrency}
					initialValues={state.initialValues}
					stickyDefaults={state.stickyDefaults}
					title={
					state.mode === "create"
						? state.initialValues?.title
							? `Duplicate: ${state.initialValues.title}`
							: state.projectName
								? `Add Expense for ${state.projectName}`
								: "New Expense"
						: state.sharedTransactionId
							? "Edit Shared Expense"
							: "Edit Expense"
				}
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

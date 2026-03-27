"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

import { RecurringModal } from "~/components/recurring-modal";

type RecurringModalContextValue = {
	openNewRecurring: () => void;
	openRecurring: (id: string) => void;
	isOpen: boolean;
};

const RecurringModalContext = createContext<
	RecurringModalContextValue | undefined
>(undefined);

export function RecurringModalProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<{
		open: boolean;
		templateId: string | null;
	}>({
		open: false,
		templateId: null,
	});

	const openNewRecurring = useCallback(() => {
		setState({ open: true, templateId: null });
	}, []);

	const openRecurring = useCallback((id: string) => {
		setState({ open: true, templateId: id });
	}, []);

	const handleClose = useCallback(() => {
		setState({ open: false, templateId: null });
	}, []);

	const value = useMemo(
		() => ({
			openNewRecurring,
			openRecurring,
			isOpen: state.open,
		}),
		[openNewRecurring, openRecurring, state.open],
	);

	return (
		<RecurringModalContext.Provider value={value}>
			{children}
			{state.open && (
				<RecurringModal
					onClose={handleClose}
					open={state.open}
					templateId={state.templateId}
				/>
			)}
		</RecurringModalContext.Provider>
	);
}

export function useRecurringModal() {
	const context = useContext(RecurringModalContext);
	if (!context) {
		throw new Error(
			"useRecurringModal must be used within RecurringModalProvider",
		);
	}
	return context;
}

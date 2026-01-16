"use client";

import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { ErrorModal } from "~/components/error-modal";

interface ErrorContextType {
	showError: (error: unknown) => void;
	clearError: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export function useError() {
	const context = useContext(ErrorContext);
	if (context === undefined) {
		throw new Error("useError must be used within an ErrorProvider");
	}
	return context;
}

export const GLOBAL_ERROR_EVENT = "global-error";

export function ErrorProvider({ children }: { children: React.ReactNode }) {
	const [error, setError] = useState<{
		message: string;
		details?: string;
	} | null>(null);

	const showError = useCallback((err: unknown) => {
		let message = "An unexpected error occurred.";
		let details = "";

		if (err instanceof Error) {
			message = err.message;
			details = err.stack ?? "";
		} else if (typeof err === "string") {
			message = err;
		} else if (typeof err === "object" && err !== null && "message" in err) {
			message = (err as { message: string }).message;
		}

		// Don't show network cancellation errors
		if (message === "Network request failed" || message === "Aborted") {
			return;
		}

		setError({ message, details });
	}, []);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	// Listen for global error events (dispatched by tRPC query client)
	useEffect(() => {
		const handleGlobalError = (event: Event) => {
			const customEvent = event as CustomEvent;
			showError(customEvent.detail);
		};

		window.addEventListener(GLOBAL_ERROR_EVENT, handleGlobalError);
		return () => {
			window.removeEventListener(GLOBAL_ERROR_EVENT, handleGlobalError);
		};
	}, [showError]);

	return (
		<ErrorContext.Provider value={{ showError, clearError }}>
			{children}
			{error && (
				<ErrorModal
					details={error.details}
					isOpen={!!error}
					message={error.message}
					onClose={clearError}
				/>
			)}
		</ErrorContext.Provider>
	);
}

import { useEffect, useState } from "react";
import { useSession } from "~/hooks/use-session";

const DRAFT_EXPENSES_KEY = "retrospend-drafts";

interface DraftExpense {
	id: string;
	title: string | null;
	amount: string;
	currency: string;
	exchangeRate: string | null;
	amountInUSD: string | null;
	pricingSource?: string | null;
	date: string;
	location: string | null;
	description: string | null;
	categoryId: string | null;
	createdAt: string;
	updatedAt: string;
}

export function useDraftExpenses() {
	const { data: session } = useSession();
	const [localDrafts, setLocalDrafts] = useState<DraftExpense[]>([]);

	// Load drafts from localStorage on mount
	useEffect(() => {
		if (!session?.user?.id) return;

		try {
			const stored = localStorage.getItem(DRAFT_EXPENSES_KEY);
			if (stored) {
				const allDrafts = JSON.parse(stored);
				// Validate structure before using
				if (allDrafts && typeof allDrafts === 'object' && !Array.isArray(allDrafts)) {
					const userDrafts = allDrafts[session.user.id];
					if (Array.isArray(userDrafts)) {
						setLocalDrafts(userDrafts);
					}
				}
			}
		} catch (error) {
			// Clear corrupted data
			localStorage.removeItem(DRAFT_EXPENSES_KEY);
			console.error("Failed to load drafts, clearing corrupted data:", error);
		}
	}, [session?.user?.id]);

	// Save drafts to localStorage
	const saveToLocalStorage = (drafts: DraftExpense[]) => {
		if (!session?.user?.id) return;

		try {
			const stored = localStorage.getItem(DRAFT_EXPENSES_KEY);
			const allDrafts = stored ? JSON.parse(stored) : {};
			allDrafts[session.user.id] = drafts;
			localStorage.setItem(DRAFT_EXPENSES_KEY, JSON.stringify(allDrafts));
			setLocalDrafts(drafts);
		} catch (error) {
			// Failed to save drafts to localStorage silently
		}
	};

	// Add or update a draft
	const updateDraft = (draft: DraftExpense) => {
		const existingIndex = localDrafts.findIndex((d) => d.id === draft.id);
		let newDrafts: DraftExpense[];

		if (existingIndex >= 0) {
			// Update existing draft
			newDrafts = [...localDrafts];
			newDrafts[existingIndex] = {
				...draft,
				updatedAt: new Date().toISOString(),
			};
		} else {
			// Add new draft
			newDrafts = [...localDrafts, draft];
		}

		saveToLocalStorage(newDrafts);
	};

	// Remove a draft (when finalized)
	const removeDraft = (id: string) => {
		const newDrafts = localDrafts.filter((d) => d.id !== id);
		saveToLocalStorage(newDrafts);
	};

	return {
		localDrafts,
		updateDraft,
		removeDraft,
	};
}

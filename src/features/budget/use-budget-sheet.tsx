"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { BudgetSheetArgs, BudgetSheetId } from "./sheet-ids";
import { BUDGET_SHEETS, type BudgetSheets } from "./sheet-registry";

type Open = {
	[Id in BudgetSheetId]: { id: Id; args: BudgetSheetArgs[Id] };
}[BudgetSheetId];

type Api = {
	/** Open a sheet by id. A sheet with no renderer yet is a quiet no-op. */
	open: <Id extends BudgetSheetId>(id: Id, args: BudgetSheetArgs[Id]) => void;
	/** Whether a sheet is registered (a button may hide without one). */
	has: (id: BudgetSheetId) => boolean;
};

const Context = createContext<Api | null>(null);

/**
 * The one place the Budget page opens sheets from (S4C). One sheet at a
 * time; the next `open` replaces it. `sheets` is injectable for tests.
 */
export function BudgetSheetsProvider({
	children,
	sheets = BUDGET_SHEETS,
}: {
	children: ReactNode;
	sheets?: BudgetSheets;
}) {
	const [current, setCurrent] = useState<Open | null>(null);
	const open = useCallback<Api["open"]>(
		(id, args) => {
			if (sheets[id]) setCurrent({ id, args } as Open);
		},
		[sheets],
	);
	const api = useMemo<Api>(
		() => ({ open, has: (id) => Boolean(sheets[id]) }),
		[open, sheets],
	);
	return (
		<Context.Provider value={api}>
			{children}
			{current && <Mounted current={current} onClose={() => setCurrent(null)} sheets={sheets} />}
		</Context.Provider>
	);
}

function Mounted({
	current,
	sheets,
	onClose,
}: {
	current: Open;
	sheets: BudgetSheets;
	onClose: () => void;
}) {
	// The registry types each component by its own id; the id picks it.
	const Sheet = sheets[current.id] as
		| React.ComponentType<{ args: unknown; onClose: () => void }>
		| undefined;
	return Sheet ? <Sheet args={current.args} onClose={onClose} /> : null;
}

/** `const sheet = useBudgetSheet(); sheet.open("assign", { month })`. */
export function useBudgetSheet(): Api {
	const api = useContext(Context);
	if (!api)
		throw new Error("useBudgetSheet needs a BudgetSheetsProvider above it");
	return api;
}

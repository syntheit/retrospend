"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { BudgetSheetId } from "../sheet-ids";
import { SheetsContext } from "./controls";
import { SHEETS } from "./registry";
import type { OpenSheet } from "./types";

type Active = { id: BudgetSheetId; params: object; key: number };

/**
 * Opens the Budget sheets by id. The page wraps itself in the provider with
 * the month on screen; any part of it then calls `open("cover", {...})`. One
 * sheet is open at a time. The last one stays mounted while it animates
 * closed and is replaced (not reused) by the next, so no state leaks between
 * two openings.
 */
export function BudgetSheetsProvider({
	month,
	children,
}: {
	/** The month on screen (YYYYMM); undefined: the current month. */
	month?: number;
	children: ReactNode;
}) {
	const [active, setActive] = useState<Active | null>(null);
	const [open, setOpen] = useState(false);
	const serial = useRef(0);

	const openSheet = useCallback<OpenSheet>((id, ...rest) => {
		if (!SHEETS[id]) return;
		serial.current += 1;
		setActive({ id, params: rest[0] ?? {}, key: serial.current });
		setOpen(true);
	}, []);
	const close = useCallback(() => setOpen(false), []);
	const controls = useMemo(
		() => ({ open: openSheet, close }),
		[openSheet, close],
	);

	const Sheet = active ? (SHEETS[active.id] as SheetFor | undefined) : null;
	return (
		<SheetsContext.Provider value={controls}>
			{children}
			{active && Sheet ? (
				<Sheet
					key={active.key}
					month={month}
					onClose={close}
					open={open}
					{...active.params}
				/>
			) : null}
		</SheetsContext.Provider>
	);
}

type SheetFor = (props: {
	open: boolean;
	onClose: () => void;
	month: number | undefined;
}) => ReactNode;

export { useBudgetSheets } from "./controls";

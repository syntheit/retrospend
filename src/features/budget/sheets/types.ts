/** What the registry adapter hands every sheet besides its own arguments. */
export type SheetShell = {
	open: boolean;
	onClose: () => void;
	/** The month on screen (YYYYMM); undefined: the current month. */
	month: number | undefined;
};

/** A sheet's props: the shell plus the arguments it needs. */
export type SheetProps<Args = Record<never, never>> = SheetShell & Args;

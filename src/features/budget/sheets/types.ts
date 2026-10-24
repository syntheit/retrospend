import type { BudgetSheetId } from "../sheet-ids";

/** What a caller passes to open each sheet. Every sheet works on one month (default: the current one). */
export type BudgetSheetParams = {
	assign: Record<string, never>;
	cover: { envelopeId: string };
	coverAll: Record<string, never>;
	move: {
		envelopeId: string;
		/** Add money (from another place) or Take money out. */
		direction?: "in" | "out";
		amountMinor?: number;
	};
	target: { envelopeId: string };
	wealth: { envelopeId: string };
	close: { month?: number };
	owed: Record<string, never>;
	settle: { personId: string };
	forgive: { personId: string };
	plan: { amountMinor?: number };
	takeBack: Record<string, never>;
	migrate: Record<string, never>;
	whatMoved: Record<string, never>;
	fundNow: Record<string, never>;
	income: Record<string, never>;
	fromWealth: { entryId?: string };
	rules: Record<string, never>;
	help: Record<string, never>;
	envelope: { envelopeId?: string };
	merge: Record<string, never>;
	afford: Record<string, never>;
	style: Record<string, never>;
	debt: Record<string, never>;
	payDebt: { liabilityId?: string };
	raiseLimit: { envelopeId: string };
	setLimit: Record<string, never>;
	whatIf: { envelopeId?: string };
	setup: Record<string, never>;
	welcomeBack: Record<string, never>;
	reconcile: Record<string, never>;
	explain: { figure: string; envelopeId?: string };
};

/** What the host hands every sheet besides its own params. */
export type SheetShell = {
	open: boolean;
	onClose: () => void;
	/** The month on screen (YYYYMM); undefined: the current month. */
	month: number | undefined;
};

export type SheetComponentProps<K extends BudgetSheetId> = SheetShell &
	BudgetSheetParams[K];

export type OpenSheet = <K extends BudgetSheetId>(
	id: K,
	...params: Record<string, never> extends BudgetSheetParams[K]
		? [params?: BudgetSheetParams[K]]
		: [params: BudgetSheetParams[K]]
) => void;

import type { BudgetSheetId } from "../sheet-ids";

/** What a caller passes to open each sheet. Every sheet works on one month (default: the current one). */
export type BudgetSheetParams = {
	assign: Record<never, never>;
	cover: { envelopeId: string };
	coverAll: Record<never, never>;
	move: {
		envelopeId: string;
		/** Add money (from another place) or Take money out. */
		direction?: "in" | "out";
		amountMinor?: number;
	};
	target: { envelopeId: string };
	wealth: { envelopeId: string };
	close: { closedMonth: number };
	owed: Record<never, never>;
	settle: { personId: string };
	forgive: { participant: { type: "user" | "guest" | "shadow"; id: string } };
	plan: { amountMinor?: number };
	takeBack: Record<never, never>;
	migrate: Record<never, never>;
	whatMoved: Record<never, never>;
	fundNow: { draftId: string };
	income: Record<never, never>;
	fromWealth: { entryId?: string };
	rules: Record<never, never>;
	help: Record<never, never>;
	envelope: { envelopeId?: string };
	merge: Record<never, never>;
	afford: Record<never, never>;
	style: Record<never, never>;
	debt: Record<never, never>;
	payDebt: { liabilityId?: string };
	raiseLimit: { envelopeId: string };
	setLimit: Record<never, never>;
	whatIf: { envelopeId?: string };
	setup: Record<never, never>;
	welcomeBack: Record<never, never>;
	reconcile: Record<never, never>;
	explain: { figure: "toAssign" | "left"; envelopeId?: string };
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
	...params: keyof BudgetSheetParams[K] extends never
		? [params?: BudgetSheetParams[K]]
		: [params: BudgetSheetParams[K]]
) => void;

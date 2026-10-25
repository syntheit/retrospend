"use client";

import { useTranslations } from "next-intl";
import * as React from "react";

import {
	isSingleLineField,
	isToastTarget,
	menuTriggerOf,
	returnFocus,
	SHEET_TEXT_FIELDS,
	type SheetDetent,
	type SheetSubmitResult,
	SubmitGuard,
	sheetKeySubmits,
} from "~/components/ui/sheet-behavior";
import {
	clearSheetAlert,
	trackOpenSheet,
	useSheetAlert,
} from "~/components/ui/toast";

export interface SheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Text only: no icon, no colored stripe (GUIDELINE §10). */
	title: string;
	/** One short line under the title; read by screen readers. */
	description?: string;
	/** Phone: the detent it opens at. Desktop ignores it. */
	detent?: SheetDetent;
	/** Desktop: a wider dialog for two-column content. */
	wide?: boolean;
	/** The specific verb ("Add expense", "Record"). No submit button without it. */
	submitLabel?: string;
	cancelLabel?: string;
	/**
	 * Phone web only (ADD-EXPENSE-R2): the short save verb ("Add", "Save") in
	 * the header, with close on the left and the title centered. The footer
	 * then holds only what `footer` gives it (Add and new); desktop keeps the
	 * footer's Cancel and verb.
	 */
	headerSubmit?: string;
	/** Return false to stay open. A throw keeps the sheet open with an inline error. */
	onSubmit?: () => SheetSubmitResult | Promise<SheetSubmitResult>;
	submitDisabled?: boolean;
	/** Replaces the default Cancel + verb footer; false hides the footer. */
	footer?: React.ReactNode | false;
	/** Where focus goes on close when the opener is gone; defaults to the opener, then its menu's trigger. */
	returnFocusTo?: React.RefObject<HTMLElement | null>;
	children?: React.ReactNode;
	className?: string;
}

export type SheetState = ReturnType<typeof useSheetState>;

/** Open tracking, focus return, the submit guard and the Enter keys. */
export function useSheetState(props: SheetProps) {
	const { open, onOpenChange } = props;
	const t = useTranslations("overlays.sheet");
	const contentRef = React.useRef<HTMLDivElement>(null);
	const openers = React.useRef<(HTMLElement | null)[]>([]);
	const guard = React.useRef(new SubmitGuard()).current;
	const [busy, setBusy] = React.useState(false);
	const [failure, setFailure] = React.useState<SheetError | null>(null);
	const [sheetId, setSheetId] = React.useState<number | null>(null);
	const alert = useSheetAlert(sheetId);

	// Layout effects run before Radix moves focus into the sheet (a passive
	// effect), so this still sees the opener and the menu it sits in.
	React.useLayoutEffect(() => {
		if (!open) return;
		const opener = document.activeElement as HTMLElement | null;
		const lookup = (sel: string) => document.querySelector<HTMLElement>(sel);
		openers.current = [
			opener,
			menuTriggerOf(opener, lookup) as HTMLElement | null,
		];
		setFailure(null);
		const tracked = trackOpenSheet();
		setSheetId(tracked.id);
		return tracked.release;
	}, [open]);

	React.useLayoutEffect(() => guard.syncOpen(open));

	const requestClose = React.useCallback(() => {
		if (guard.canClose) onOpenChange(false);
	}, [guard, onOpenChange]);

	const submit = React.useCallback(async () => {
		if (!props.onSubmit || props.submitDisabled) return;
		setFailure(null);
		clearSheetAlert(sheetId);
		const out = await guard.run(
			props.onSubmit,
			() => onOpenChange(false),
			setBusy,
		);
		if (out.status === "failed")
			setFailure({ text: t("failed"), detail: errorDetail(out.error) });
	}, [guard, onOpenChange, props.onSubmit, props.submitDisabled, sheetId, t]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (!props.onSubmit || !enterSubmits(e, contentRef.current)) return;
		e.preventDefault();
		void submit();
	};

	const layer = {
		ref: contentRef,
		"data-sheet": "",
		onKeyDown,
		// Focus lands on the task (the first field, else the verb), not on
		// Close: the header button would also pop its tooltip on every open.
		onOpenAutoFocus: (e: Event) => {
			const root = contentRef.current;
			const first =
				root?.querySelector<HTMLElement>(
					`[data-sheet-body] :is(${FOCUSABLE})`,
				) ?? root?.querySelector<HTMLElement>("[data-sheet-submit]");
			if (!first) return;
			e.preventDefault();
			first.focus({ preventScroll: true });
		},
		onCloseAutoFocus: (e: Event) => {
			e.preventDefault();
			returnFocus(props.returnFocusTo?.current, ...openers.current);
		},
		onPointerDownOutside: (e: {
			target: EventTarget | null;
			preventDefault(): void;
		}) => {
			if (isToastTarget(e.target as Element | null)) e.preventDefault();
		},
		// Without a description, an explicit undefined tells Radix that is on purpose.
		...(props.description ? {} : { "aria-describedby": undefined }),
	};

	const error = failure ?? (alert ? { text: alert } : null);
	return { layer, busy, error, submit, requestClose, t };
}

const FOCUSABLE =
	"input:not([type=hidden]):not([disabled]), select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

type SheetError = { text: string; detail?: string };

/** Enter or Cmd+Enter in this sheet (not a nested one) that should submit it. */
function enterSubmits(
	e: React.KeyboardEvent,
	root: HTMLElement | null,
): boolean {
	// A field that handled Enter itself (a typed date, a picker) wins.
	if (e.defaultPrevented || !root) return false;
	const target = e.target as HTMLElement;
	const own = [...root.querySelectorAll(SHEET_TEXT_FIELDS)].filter(
		(f) => f.closest("[data-sheet]") === root,
	);
	return sheetKeySubmits(e.nativeEvent, {
		inThisSheet: target.closest("[data-sheet]") === root,
		targetIsTextField: isSingleLineField(target as HTMLInputElement),
		fieldCount: own.length,
	});
}

/** The server's message, shown muted under "Couldn't save" (GUIDELINE §12). */
function errorDetail(error: unknown): string | undefined {
	return error instanceof Error && error.message ? error.message : undefined;
}

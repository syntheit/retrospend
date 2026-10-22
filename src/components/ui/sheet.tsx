"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Drawer } from "vaul";

import { Button } from "~/components/ui/button";
import {
	DETENT_SNAP,
	detentOf,
	isSingleLineField,
	isToastTarget,
	menuTriggerOf,
	returnFocus,
	SHEET_TEXT_FIELDS,
	SNAP_POINTS,
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
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";

export type { SheetDetent, SheetSubmitResult };

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

/** Nesting depth: a sheet opened from inside a sheet is nested. */
const SheetDepth = React.createContext(0);

/**
 * Sheet: one task that finishes in place. A dialog on desktop, a bottom
 * sheet with medium and large detents on a phone (vaul snap points). Esc
 * closes the top sheet only, focus is trapped and returns to what opened it,
 * Cmd or Ctrl+Enter submits, and a nested sheet's Cancel returns to its
 * parent. No glass on the web (glass is iOS chrome only, R17).
 */
export function Sheet(props: SheetProps) {
	const phone = useIsMobile();
	const depth = React.useContext(SheetDepth);
	const s = useSheetState(props);
	const body = <SheetBody {...props} depth={depth} state={s} />;
	return phone ? (
		<PhoneSheet {...props} nested={depth > 0} state={s}>
			{body}
		</PhoneSheet>
	) : (
		<DesktopSheet {...props} state={s}>
			{body}
		</DesktopSheet>
	);
}

type SheetState = ReturnType<typeof useSheetState>;

/** Open tracking, focus return, the submit guard and the Enter keys. */
function useSheetState(props: SheetProps) {
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

function SheetBody(props: SheetProps & { depth: number; state: SheetState }) {
	const { state: s } = props;
	return (
		<SheetDepth.Provider value={props.depth + 1}>
			<div className="flex items-center gap-2 px-6 pt-4 pb-2 max-md:px-4 max-md:pt-2">
				<DialogPrimitive.Title className="min-w-0 flex-1 truncate text-fg text-section">
					{props.title}
				</DialogPrimitive.Title>
				<Button
					aria-label={s.t("close")}
					onClick={s.requestClose}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<XIcon />
				</Button>
			</div>
			{props.description ? (
				<DialogPrimitive.Description className="px-6 pb-2 text-fg-2 text-small max-md:px-4">
					{props.description}
				</DialogPrimitive.Description>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-2 max-md:px-4">
				{props.children}
			</div>
			{s.error ? (
				<div className="px-6 py-2 text-small max-md:px-4" role="alert">
					<p className="text-danger">{s.error.text}</p>
					{s.error.detail ? (
						<p className="text-fg-3">{s.error.detail}</p>
					) : null}
				</div>
			) : null}
			{props.footer === false ? null : (
				<div className="flex items-center justify-end gap-2 border-line border-t px-6 py-3 max-md:px-4 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
					{props.footer ?? (
						<>
							<Button onClick={s.requestClose} type="button" variant="outline">
								{props.cancelLabel ?? s.t("cancel")}
							</Button>
							{props.submitLabel ? (
								<Button
									disabled={props.submitDisabled || s.busy}
									onClick={() => void s.submit()}
									type="button"
								>
									{props.submitLabel}
								</Button>
							) : null}
						</>
					)}
				</div>
			)}
		</SheetDepth.Provider>
	);
}

type FrameProps = SheetProps & { state: SheetState; children: React.ReactNode };

/**
 * Phone: vaul snap points at the kit's 52% and 94%. A flick moves between
 * detents and only closes from the lowest. The content is the large height;
 * at the medium detent the inner column shrinks to the visible part so the
 * footer stays on screen.
 */
function PhoneSheet(props: FrameProps & { nested: boolean }) {
	const { state: s } = props;
	const start = DETENT_SNAP[props.detent ?? "large"];
	const [snap, setSnap] = React.useState<number | string | null>(start);
	React.useLayoutEffect(() => {
		if (props.open) setSnap(start);
	}, [props.open, start]);
	const Root = props.nested ? Drawer.NestedRoot : Drawer.Root;
	const detent = detentOf(snap);
	return (
		<Root
			activeSnapPoint={snap}
			fadeFromIndex={0}
			onOpenChange={(o) => (o ? props.onOpenChange(true) : s.requestClose())}
			open={props.open}
			setActiveSnapPoint={setSnap}
			snapPoints={SNAP_POINTS}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-50 bg-scrim" />
				<Drawer.Content
					{...s.layer}
					className={cn(
						"fixed inset-x-0 bottom-0 z-50 flex h-[94dvh] flex-col rounded-t-panel border-line-strong border-t bg-surface text-fg shadow-menu outline-none focus-visible:ring-2 focus-visible:ring-brand",
						props.className,
					)}
					data-detent={detent}
				>
					<div
						className={cn(
							"flex flex-col transition-[height] duration-(--t-sheet) ease-land",
							detent === "medium" ? "h-[52dvh]" : "h-[94dvh]",
						)}
					>
						<Drawer.Handle className="my-2 h-1 w-10 shrink-0 rounded-chip bg-line-strong" />
						{props.children}
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Root>
	);
}

function DesktopSheet(props: FrameProps) {
	const { state: s } = props;
	return (
		<DialogPrimitive.Root
			onOpenChange={(o) => (o ? props.onOpenChange(true) : s.requestClose())}
			open={props.open}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-scrim duration-(--t-menu) data-[state=closed]:animate-out data-[state=open]:animate-in" />
				<DialogPrimitive.Content
					{...s.layer}
					className={cn(
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface text-fg shadow-menu outline-none duration-(--t-menu) ease-land focus-visible:ring-2 focus-visible:ring-brand data-[state=closed]:animate-out data-[state=open]:animate-in",
						props.wide ? "max-w-3xl" : "max-w-xl",
						props.className,
					)}
				>
					{props.children}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";
import { Drawer } from "vaul";

import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import {
	DETENT_SNAP,
	detentOf,
	keyboardInset,
	SNAP_POINTS,
	type SheetDetent,
	type SheetSubmitResult,
} from "~/components/ui/sheet-behavior";
import {
	type SheetProps,
	type SheetState,
	useSheetState,
} from "~/components/ui/sheet-state";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";

export type { SheetDetent, SheetProps, SheetSubmitResult };

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

function SheetBody(props: SheetProps & { depth: number; state: SheetState }) {
	const { state: s } = props;
	return (
		<SheetDepth.Provider value={props.depth + 1}>
			<div className="flex items-center gap-2 px-6 pt-4 pb-2 max-md:px-4 max-md:pt-2">
				<DialogPrimitive.Title className="min-w-0 flex-1 truncate text-fg text-section">
					{props.title}
				</DialogPrimitive.Title>
				<Tip content={s.t("close")}>
					<Button
						aria-label={s.t("close")}
						onClick={s.requestClose}
						icon
						kind="ghost"
					>
						<XIcon />
					</Button>
				</Tip>
			</div>
			{props.description ? (
				<DialogPrimitive.Description className="px-6 pb-2 text-fg-2 text-small max-md:px-4">
					{props.description}
				</DialogPrimitive.Description>
			) : null}
			<div
				className="min-h-0 flex-1 overflow-y-auto px-6 py-2 max-md:px-4"
				data-sheet-body=""
			>
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
							<Button kind="secondary" onClick={s.requestClose}>
								{props.cancelLabel ?? s.t("cancel")}
							</Button>
							{props.submitLabel ? (
								<Button
									disabled={props.submitDisabled}
									data-sheet-submit=""
									kind="primary"
									loading={s.busy}
									onClick={() => void s.submit()}
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
 * The on-screen keyboard's height while the sheet is open, read from the
 * visual viewport (window.innerHeight does not change when it opens).
 */
function useKeyboardInset(open: boolean): number {
	const [inset, setInset] = React.useState(0);
	React.useEffect(() => {
		const vv = window.visualViewport;
		if (!open || !vv) return;
		const update = () => setInset(keyboardInset(window.innerHeight, vv));
		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
			setInset(0);
		};
	}, [open]);
	return inset;
}

/** Scrolls the focused field inside `column` into view. */
function revealFocused(column: HTMLElement | null) {
	const el = document.activeElement;
	if (el instanceof HTMLElement && column?.contains(el)) {
		el.scrollIntoView({ block: "nearest" });
	}
}

/**
 * Phone: vaul snap points at the kit's 52% and 94%. A flick moves between
 * detents and only closes from the lowest. vaul moves the full-screen
 * content down by the part of the screen above the detent and publishes
 * that offset as --snap-point-height, so the column is the content's height
 * less the offset: it ends at the bottom of the screen at every detent and
 * the footer stays on screen. An open keyboard raises the sheet to large and
 * shortens the column by the keyboard's height, and the focused field
 * scrolls into view above the footer. vaul's own input handling is off: it
 * miscounts the offset at the medium detent and pushes the sheet down.
 */
function PhoneSheet(props: FrameProps & { nested: boolean }) {
	const { state: s } = props;
	const start = DETENT_SNAP[props.detent ?? "large"];
	const [snap, setSnap] = React.useState<number | string | null>(start);
	React.useLayoutEffect(() => {
		if (props.open) setSnap(start);
	}, [props.open, start]);
	const keyboard = useKeyboardInset(props.open);
	const column = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		if (keyboard === 0) return;
		setSnap(DETENT_SNAP.large);
		revealFocused(column.current);
	}, [keyboard]);
	const Root = props.nested ? Drawer.NestedRoot : Drawer.Root;
	return (
		<Root
			activeSnapPoint={snap}
			fadeFromIndex={0}
			onOpenChange={(o) => (o ? props.onOpenChange(true) : s.requestClose())}
			open={props.open}
			repositionInputs={false}
			setActiveSnapPoint={setSnap}
			snapPoints={SNAP_POINTS}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-50 bg-scrim" />
				<Drawer.Content
					{...s.layer}
					className={cn(
						"fixed inset-x-0 bottom-0 z-50 flex h-dvh flex-col rounded-t-panel border-line-strong border-t bg-surface text-fg shadow-menu outline-none focus-visible:ring-2 focus-visible:ring-brand",
						props.className,
					)}
					data-detent={detentOf(snap)}
				>
					<div
						className="flex h-[calc(100%-var(--snap-point-height,0px)-var(--sheet-keyboard,0px))] flex-col transition-[height] duration-(--t-sheet) ease-land"
						onTransitionEnd={() => {
							if (keyboard > 0) revealFocused(column.current);
						}}
						ref={column}
						style={
							{ "--sheet-keyboard": `${keyboard}px` } as React.CSSProperties
						}
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

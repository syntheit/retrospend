"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Drawer } from "vaul";

import { Button } from "~/components/ui/button";
import {
	isSingleLineField,
	isToastTarget,
	nextDetent,
	returnFocus,
	SHEET_TEXT_FIELDS,
	type SheetDetent,
	type SheetSubmitResult,
	SubmitGuard,
	sheetKeySubmits,
} from "~/components/ui/sheet-behavior";
import { trackOpenSheet } from "~/components/ui/toast";
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
	/** Return false to stay open. A throw also keeps the sheet open. */
	onSubmit?: () => SheetSubmitResult | Promise<SheetSubmitResult>;
	submitDisabled?: boolean;
	/** Replaces the default Cancel + verb footer; false hides the footer. */
	footer?: React.ReactNode | false;
	children?: React.ReactNode;
	className?: string;
}

/** Nesting depth: a sheet opened from inside a sheet is nested. */
const SheetDepth = React.createContext(0);

/**
 * Sheet: one task that finishes in place. A dialog on desktop, a bottom
 * sheet with medium and large detents on a phone (vaul). Esc closes the top
 * sheet only, focus is trapped and returns to what opened it, Cmd or
 * Ctrl+Enter submits, and a nested sheet's Cancel returns to its parent.
 * No glass on the web (glass is iOS chrome only, R17).
 */
export function Sheet(props: SheetProps) {
	const { open, onOpenChange, title, description, children } = props;
	const t = useTranslations("overlays.sheet");
	const phone = useIsMobile();
	const depth = React.useContext(SheetDepth);
	const contentRef = React.useRef<HTMLDivElement>(null);
	const openerRef = React.useRef<HTMLElement | null>(null);
	const guard = React.useRef(new SubmitGuard()).current;
	const [busy, setBusy] = React.useState(false);
	const [detent, setDetent] = React.useState<SheetDetent>(
		props.detent ?? "large",
	);

	// Layout effects run before Radix moves focus into the sheet (a passive
	// effect), so this still sees the opener.
	React.useLayoutEffect(() => {
		if (!open) return;
		openerRef.current = document.activeElement as HTMLElement | null;
		guard.reset();
		setDetent(props.detent ?? "large");
		return trackOpenSheet();
	}, [open, guard, props.detent]);

	const close = React.useCallback(() => {
		guard.markClosing();
		onOpenChange(false);
	}, [guard, onOpenChange]);

	const submit = React.useCallback(() => {
		if (!props.onSubmit || props.submitDisabled) return;
		void guard.run(props.onSubmit, close, setBusy);
	}, [guard, close, props.onSubmit, props.submitDisabled]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		// A field that handled Enter itself (a typed date, a picker) wins.
		if (e.defaultPrevented) return;
		const root = contentRef.current;
		const target = e.target as HTMLElement;
		const fields = root?.querySelectorAll(SHEET_TEXT_FIELDS) ?? [];
		const own = [...fields].filter((f) => f.closest("[data-sheet]") === root);
		const submits = sheetKeySubmits(e.nativeEvent, {
			inThisSheet: target.closest("[data-sheet]") === root,
			targetIsTextField: isSingleLineField(target as HTMLInputElement),
			fieldCount: own.length,
		});
		if (!submits || !props.onSubmit) return;
		e.preventDefault();
		submit();
	};

	const layer = {
		ref: contentRef,
		"data-sheet": "",
		onKeyDown,
		onCloseAutoFocus: (e: Event) => {
			e.preventDefault();
			returnFocus(openerRef.current);
		},
		onPointerDownOutside: (e: {
			target: EventTarget | null;
			preventDefault(): void;
		}) => {
			if (isToastTarget(e.target as Element | null)) e.preventDefault();
		},
		// Without a description, an explicit undefined tells Radix that is on purpose.
		...(description ? {} : { "aria-describedby": undefined }),
	};

	const body = (
		<SheetDepth.Provider value={depth + 1}>
			<SheetHeader closeLabel={t("close")} onClose={close} title={title} />
			{description ? (
				<DialogPrimitive.Description className="px-6 pb-2 text-fg-2 text-small max-md:px-4">
					{description}
				</DialogPrimitive.Description>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-2 max-md:px-4">
				{children}
			</div>
			{props.footer === false ? null : (
				<div className="flex items-center justify-end gap-2 border-line border-t px-6 py-3 max-md:px-4 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
					{props.footer ?? (
						<>
							<Button onClick={close} type="button" variant="outline">
								{props.cancelLabel ?? t("cancel")}
							</Button>
							{props.submitLabel ? (
								<Button
									disabled={props.submitDisabled || busy}
									onClick={submit}
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

	if (phone) {
		const Root = depth > 0 ? Drawer.NestedRoot : Drawer.Root;
		return (
			<Root
				onOpenChange={(o) => (o ? onOpenChange(true) : close())}
				open={open}
			>
				<Drawer.Portal>
					<Drawer.Overlay className="fixed inset-0 z-50 bg-scrim" />
					<Drawer.Content
						{...layer}
						className={cn(
							"fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-panel border-line-strong border-t bg-surface text-fg shadow-menu outline-none transition-[max-height] duration-(--t-sheet) ease-land focus-visible:ring-2 focus-visible:ring-brand",
							detent === "medium" ? "max-h-[55dvh]" : "max-h-[92dvh]",
							props.className,
						)}
						data-detent={detent}
					>
						<Grabber
							onRelease={(dy) => {
								const next = nextDetent(detent, dy);
								if (next === "close") close();
								else setDetent(next);
							}}
						/>
						{body}
					</Drawer.Content>
				</Drawer.Portal>
			</Root>
		);
	}

	return (
		<DialogPrimitive.Root
			onOpenChange={(o) => (o ? onOpenChange(true) : close())}
			open={open}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-scrim duration-(--t-menu) data-[state=closed]:animate-out data-[state=open]:animate-in" />
				<DialogPrimitive.Content
					{...layer}
					className={cn(
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface text-fg shadow-menu outline-none duration-(--t-menu) ease-land focus-visible:ring-2 focus-visible:ring-brand data-[state=closed]:animate-out data-[state=open]:animate-in",
						props.wide ? "max-w-3xl" : "max-w-xl",
						props.className,
					)}
				>
					{body}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function SheetHeader({
	title,
	closeLabel,
	onClose,
}: {
	title: string;
	closeLabel: string;
	onClose: () => void;
}) {
	return (
		<div className="flex items-center gap-2 px-6 pt-4 pb-2 max-md:px-4 max-md:pt-2">
			<DialogPrimitive.Title className="min-w-0 flex-1 truncate text-fg text-section">
				{title}
			</DialogPrimitive.Title>
			<Button
				aria-label={closeLabel}
				onClick={onClose}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<XIcon />
			</Button>
		</div>
	);
}

/** The phone grabber: drag up for large, down for medium or to close. */
function Grabber({ onRelease }: { onRelease: (dy: number) => void }) {
	const start = React.useRef<number | null>(null);
	return (
		<div
			aria-hidden="true"
			className="flex h-6 shrink-0 touch-none items-center justify-center"
			onPointerCancel={() => {
				start.current = null;
			}}
			onPointerDown={(e) => {
				start.current = e.clientY;
			}}
			onPointerUp={(e) => {
				if (start.current == null) return;
				const dy = e.clientY - start.current;
				start.current = null;
				onRelease(dy);
			}}
		>
			<span className="h-1 w-10 rounded-chip bg-line-strong" />
		</div>
	);
}

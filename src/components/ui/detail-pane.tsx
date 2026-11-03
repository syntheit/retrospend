"use client";

import { ChevronLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";

/**
 * DetailPane: the view-only pane that sits beside a list (T2, provisional).
 * From md up it is a column to the right of the page, with a close button;
 * on a phone it is a full page over the app with a back chevron. The header
 * holds the title and the `actions` (pencil, overflow); the body scrolls.
 */
export function DetailPane({
	title,
	label,
	actions,
	onClose,
	closeLabel,
	phone,
	children,
	className,
}: {
	title: ReactNode;
	/** The accessible name of the pane (plain text of the title). */
	label: string;
	actions?: ReactNode;
	onClose: () => void;
	closeLabel: string;
	/** A phone: a page over the app, back chevron in the lead. */
	phone: boolean;
	children: ReactNode;
	className?: string;
}) {
	const close = (
		<Tip content={closeLabel}>
			<Button aria-label={closeLabel} icon kind="ghost" onClick={onClose}>
				{phone ? <ChevronLeft aria-hidden="true" /> : <X aria-hidden="true" />}
			</Button>
		</Tip>
	);
	return (
		<aside
			aria-label={label}
			className={cn(
				"bg-bg flex min-h-0 flex-col",
				phone
					? "fixed inset-0 z-40"
					: "border-line w-80 shrink-0 border-l xl:w-90",
				className,
			)}
			data-detail-pane=""
		>
			<header className="border-line flex min-h-14 items-center gap-2 border-b px-4">
				{phone ? close : null}
				<h2 className="text-section text-fg min-w-0 flex-1 truncate font-semibold">
					{title}
				</h2>
				{actions}
				{phone ? null : close}
			</header>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
				{children}
			</div>
		</aside>
	);
}

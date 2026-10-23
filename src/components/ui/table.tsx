"use client";

import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * The design's cell look (GUIDELINE §6, kit `.table`): a surface panel, a
 * 36px header in 12px fg-3, rows at row height with hairlines, raised on
 * hover and brand-soft when selected, a footer on a strong rule.
 * Descendant selectors win over the legacy cell classes below, so tables
 * that have not moved keep today's look until the switch-over.
 */
export const TABLE_CELLS = [
	"rounded-panel bg-surface text-body text-fg",
	"[&_th]:h-9 [&_th]:border-line [&_th]:border-b [&_th]:bg-surface [&_th]:px-3 [&_th]:py-0 [&_th]:font-medium [&_th]:text-fg-3 [&_th]:text-meta",
	"[&_th:hover]:bg-surface",
	"[&_td]:h-row [&_td]:px-3 [&_td]:py-0",
	"[&_tbody_tr]:border-line",
	"can-hover:[&_tbody_tr:hover]:bg-raised",
	"[&_tbody_tr[data-state=selected]]:bg-brand-soft",
	"[&_tfoot_td]:h-11 [&_tfoot_td]:border-line-strong [&_tfoot_td]:border-t [&_tfoot_td]:bg-surface [&_tfoot_td]:px-3 [&_tfoot_td]:font-semibold",
].join(" ");

/** `panel`: the design's table, a bordered surface panel with a plain header. */
type Look = "legacy" | "panel";
const LookContext = React.createContext<Look>("legacy");

function Table({
	className,
	wrapperClassName,
	look = "legacy",
	...props
}: React.ComponentProps<"table"> & { wrapperClassName?: string; look?: Look }) {
	return (
		<LookContext.Provider value={look}>
			<div
				className={cn(
					"relative w-full overflow-auto",
					look === "panel" && [TABLE_CELLS, "border border-line"],
					wrapperClassName,
				)}
				data-look={look === "panel" ? "panel" : undefined}
			>
				<table
					className={cn("w-full caption-bottom text-sm", className)}
					data-slot="table"
					{...props}
				/>
			</div>
		</LookContext.Provider>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	const look = React.useContext(LookContext);
	return (
		<thead
			className={cn(
				look === "panel"
					? "bg-surface sticky top-0 z-10"
					: "glass-surface sticky top-0 z-10 border-b border-(--border) [&_tr]:border-b-0",
				className,
			)}
			data-slot="table-header"
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			className={cn("[&_tr:last-child]:border-0", className)}
			data-slot="table-body"
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			className={cn(
				"sticky bottom-0 z-10 border-t bg-muted/95 font-medium backdrop-blur-sm [&>tr]:last:border-b-0",
				className,
			)}
			data-slot="table-footer"
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			className={cn(
				"border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
				className,
			)}
			data-slot="table-row"
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			className={cn(
				"h-10 whitespace-nowrap px-4 py-3 text-left align-middle font-medium text-muted-foreground text-sm [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			data-slot="table-head"
			{...props}
		/>
	);
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return (
		<td
			className={cn(
				"whitespace-nowrap px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			data-slot="table-cell"
			{...props}
		/>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<"caption">) {
	return (
		<caption
			className={cn("mt-4 text-muted-foreground text-sm", className)}
			data-slot="table-caption"
			{...props}
		/>
	);
}

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
};

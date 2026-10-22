"use client";

import { flexRender, type Header } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import type * as React from "react";
import type {
	DataTableFeatures,
	DataTableRowData,
} from "~/components/data-table-features";
import { TableHead } from "~/components/ui/table";
import { cn } from "~/lib/utils";

/**
 * One DataTable header cell. A sortable column's label is a keyboard
 * button (Enter or Space sorts) and the cell carries aria-sort; only the
 * sorted column shows a chevron. The select column's cell toggles its
 * checkbox when clicked anywhere.
 */
export function DataTableHeadCell<TData extends DataTableRowData>({
	header,
}: {
	header: Header<DataTableFeatures, TData, unknown>;
}) {
	const column = header.column;
	const canSort = column.getCanSort();
	const sorted = column.getIsSorted();
	const meta = column.columnDef.meta as Record<string, unknown> | undefined;
	const right = meta?.align === "right";
	const toggle = column.getToggleSortingHandler();
	const chevron =
		sorted === "asc" ? (
			<ChevronUp aria-hidden="true" className="size-3 shrink-0" />
		) : sorted === "desc" ? (
			<ChevronDown aria-hidden="true" className="size-3 shrink-0" />
		) : null;
	const label = header.isPlaceholder
		? null
		: flexRender(column.columnDef.header, header.getContext());
	const onSelectCell = (e: React.MouseEvent<HTMLTableCellElement>) => {
		if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
		e.currentTarget.querySelector<HTMLElement>('[role="checkbox"]')?.click();
	};
	return (
		<TableHead
			aria-sort={
				!canSort
					? undefined
					: sorted === "asc"
						? "ascending"
						: sorted === "desc"
							? "descending"
							: "none"
			}
			className={cn("hover:bg-muted/30", meta?.className as string)}
			onClick={column.id === "select" ? onSelectCell : undefined}
			style={
				column.columnDef.size != null && !meta?.flex
					? { width: column.getSize(), minWidth: column.getSize() }
					: undefined
			}
		>
			{canSort && label != null ? (
				<span
					className={cn(
						"flex cursor-pointer select-none items-center gap-1 rounded-ctl focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2",
						right && "justify-end",
					)}
					onClick={toggle}
					onKeyDown={(e) => {
						if (e.key !== "Enter" && e.key !== " ") return;
						e.preventDefault();
						toggle?.(e);
					}}
					role="button"
					tabIndex={0}
				>
					{right && chevron}
					<span className="truncate font-medium">{label}</span>
					{!right && chevron}
				</span>
			) : (
				<span
					className={cn(
						"flex select-none items-center truncate font-medium",
						right && "justify-end",
					)}
				>
					{label}
				</span>
			)}
		</TableHead>
	);
}

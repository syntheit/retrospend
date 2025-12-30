"use client";

import { Download, Edit, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";

interface DataTableSelectionBarProps {
	selectedRows: Set<string>;
	headerHeight: string;
	exportMutation: {
		isPending: boolean;
	};
	onSelectAll: (checked: boolean) => void;
	onExportSelected: () => void;
	onEditSelected?: (id: string) => void;
	onDeleteSelected?: () => void;
}

export function DataTableSelectionBar({
	selectedRows,
	headerHeight,
	exportMutation,
	onSelectAll,
	onExportSelected,
	onEditSelected,
	onDeleteSelected,
}: DataTableSelectionBarProps) {
	return (
		<div
			className={cn(
				"absolute top-0 left-0 z-10 flex w-full items-center gap-2 border-b bg-muted/95 px-4 backdrop-blur-sm transition-all duration-200",
				selectedRows.size > 0
					? "translate-y-0 opacity-100"
					: "pointer-events-none -translate-y-full opacity-0",
			)}
			style={{ height: headerHeight }}
		>
			{/* Checkbox to deselect all */}
			<Checkbox
				aria-label="Deselect all rows"
				checked={true}
				className="mr-2"
				onCheckedChange={() => onSelectAll(false)}
			/>
			<span className="font-medium text-sm">
				{selectedRows.size} item{selectedRows.size !== 1 ? "s" : ""}{" "}
				selected
			</span>
			<div className="ml-auto flex items-center gap-2">
				<Button
					className="flex h-8 items-center gap-2"
					disabled={exportMutation.isPending}
					onClick={onExportSelected}
					size="sm"
					variant="ghost"
				>
					<Download className="h-4 w-4" />
					<span className="sr-only sm:not-sr-only sm:inline-block">
						Export
					</span>
				</Button>
				{selectedRows.size === 1 && onEditSelected && (
					<Button
						className="flex h-8 items-center gap-2"
						onClick={() => {
							const id = Array.from(selectedRows)[0];
							if (id) {
								onEditSelected(id);
							}
						}}
						size="sm"
						variant="ghost"
					>
						<Edit className="h-4 w-4" />
						<span className="sr-only sm:not-sr-only sm:inline-block">
							Edit
						</span>
					</Button>
				)}
				{onDeleteSelected && (
					<Button
						className="flex h-8 items-center gap-2"
						onClick={onDeleteSelected}
						size="sm"
						variant="destructive"
					>
						<Trash2 className="h-4 w-4" />
						<span className="sr-only sm:not-sr-only sm:inline-block">
							Delete
						</span>
					</Button>
				)}
			</div>
		</div>
	);
}

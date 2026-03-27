"use client";

import { createElement, useState } from "react";
import { Copy, Download, Edit, Tags, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { getCategoryIcon } from "~/lib/category-icons";
import { getCategoryColorClasses } from "~/lib/constants";
import { cn } from "~/lib/utils";

interface DataTableSelectionBarProps {
	selectedRows: Set<string>;
	headerHeight: string;
	exportMutation?: {
		isPending: boolean;
	};
	onSelectAll: (checked: boolean) => void;
	onExportSelected?: () => void;
	onEditSelected?: (id: string) => void;
	onDuplicateSelected?: (id: string) => void;
	onDeleteSelected?: () => void;
	onRecategorize?: (categoryId: string) => void;
	categories?: Array<{
		id: string;
		name: string;
		color: string;
		icon?: string | null;
	}>;
}

export function DataTableSelectionBar({
	selectedRows,
	headerHeight,
	exportMutation,
	onSelectAll,
	onExportSelected,
	onEditSelected,
	onDuplicateSelected,
	onDeleteSelected,
	onRecategorize,
	categories,
}: DataTableSelectionBarProps) {
	const [recategorizeOpen, setRecategorizeOpen] = useState(false);

	return (
		<div
			className={cn(
				"absolute top-0 left-0 z-20 flex w-full items-center gap-2 border-b bg-muted/95 px-4 backdrop-blur-sm transition-all duration-200",
				selectedRows.size > 0
					? "translate-y-0 opacity-100"
					: "pointer-events-none -translate-y-full opacity-0",
			)}
			style={{ height: headerHeight }}
		>
			<Button
				aria-label="Deselect all rows"
				className="h-6 w-6 shrink-0"
				onClick={() => onSelectAll(false)}
				size="icon"
				variant="ghost"
			>
				<X className="h-3.5 w-3.5" />
			</Button>
			<span aria-atomic="true" aria-live="polite" className="tabular-nums font-medium text-sm">
				{selectedRows.size} item{selectedRows.size !== 1 ? "s" : ""} selected
			</span>
			<div className="ml-auto flex items-center gap-2">
				{onRecategorize && categories && categories.length > 0 && (
					<Popover
						onOpenChange={setRecategorizeOpen}
						open={recategorizeOpen}
					>
						<PopoverTrigger asChild>
							<Button
								className="flex h-8 items-center gap-2"
								size="sm"
								variant="ghost"
							>
								<Tags className="h-4 w-4" />
								<span className="sr-only sm:not-sr-only sm:inline-block">
									Recategorize
								</span>
							</Button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-56 p-1">
							<div className="max-h-64 overflow-y-auto">
								{categories.map((category) => (
									<Button
										className="w-full justify-start gap-2 px-3 py-2"
										key={category.id}
										onClick={() => {
											onRecategorize(category.id);
											setRecategorizeOpen(false);
										}}
										size="sm"
										variant="ghost"
									>
										<span
											className={cn(
												"flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
												getCategoryColorClasses(category.color, "light"),
											)}
										>
											{createElement(
												getCategoryIcon(
													category.name,
													category.icon,
												),
												{ className: "h-3 w-3" },
											)}
										</span>
										<span className="truncate">
											{category.name}
										</span>
									</Button>
								))}
							</div>
						</PopoverContent>
					</Popover>
				)}
				{onExportSelected && exportMutation && (
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
				)}
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
						<span className="sr-only sm:not-sr-only sm:inline-block">Edit</span>
					</Button>
				)}
				{selectedRows.size === 1 && onDuplicateSelected && (
					<Button
						className="flex h-8 items-center gap-2"
						onClick={() => {
							const id = Array.from(selectedRows)[0];
							if (id) {
								onDuplicateSelected(id);
							}
						}}
						size="sm"
						variant="ghost"
					>
						<Copy className="h-4 w-4" />
						<span className="sr-only sm:not-sr-only sm:inline-block">Duplicate</span>
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

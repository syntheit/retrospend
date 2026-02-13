import {
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
} from "@tabler/icons-react";
import { type Table } from "@tanstack/react-table";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

interface TablePaginationProps<TData> {
	table: Table<TData>;
	pageSizeOptions?: number[];
	className?: string;
}

export function TablePagination<TData>({
	table,
	pageSizeOptions = [10, 20, 30, 40, 50],
	className,
}: TablePaginationProps<TData>) {
	return (
		<div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", className)}>
			<div className="flex items-center gap-2">
				<Label className="font-medium text-sm" htmlFor="rows-per-page">
					Rows per page
				</Label>
				<Select
					onValueChange={(value) => {
						table.setPageSize(Number(value));
					}}
					value={`${table.getState().pagination.pageSize}`}
				>
					<SelectTrigger className="w-20" id="rows-per-page" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{pageSizeOptions.map((pageSize) => (
							<SelectItem key={pageSize} value={`${pageSize}`}>
								{pageSize}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex items-center gap-2">
				<div className="text-muted-foreground text-sm">
					Page {table.getState().pagination.pageIndex + 1} of{" "}
					{table.getPageCount()}
				</div>
				<div className="flex items-center gap-1">
					<Button
						disabled={!table.getCanPreviousPage()}
						onClick={() => table.setPageIndex(0)}
						size="sm"
						variant="outline"
					>
						<IconChevronsLeft className="size-4" />
					</Button>
					<Button
						disabled={!table.getCanPreviousPage()}
						onClick={() => table.previousPage()}
						size="sm"
						variant="outline"
					>
						<IconChevronLeft className="size-4" />
					</Button>
					<Button
						disabled={!table.getCanNextPage()}
						onClick={() => table.nextPage()}
						size="sm"
						variant="outline"
					>
						<IconChevronRight className="size-4" />
					</Button>
					<Button
						disabled={!table.getCanNextPage()}
						onClick={() => table.setPageIndex(table.getPageCount() - 1)}
						size="sm"
						variant="outline"
					>
						<IconChevronsRight className="size-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}

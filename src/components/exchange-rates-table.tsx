import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	IconChevronDown,
	IconChevronUp,
	IconGripVertical,
} from "@tabler/icons-react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { Heart } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { DEFAULT_PAGE_SIZE } from "~/lib/constants";
import { cn, getCurrencyName } from "~/lib/utils";
import { TablePagination } from "./table-pagination";
import { TableSearch } from "./table-search";

export const exchangeRateSchema = z.object({
	id: z.string(),
	date: z.date(),
	currency: z.string(),
	type: z.string(),
	rate: z.number(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

type ExchangeRate = z.infer<typeof exchangeRateSchema> & {
	isFavorite?: boolean;
};

interface ExchangeRateColumnOptions {
	onToggleFavorite: (id: string) => Promise<void>;
	favoriteLoadingId: string | null;
	isDraggable: boolean;
}

function createExchangeRateColumns({
	onToggleFavorite,
	favoriteLoadingId,
	isDraggable,
}: ExchangeRateColumnOptions): ColumnDef<ExchangeRate>[] {
	return [
		...(isDraggable
			? [
					{
						id: "drag",
						header: () => <span className="sr-only">Move</span>,
						cell: () => (
							<Button
								className="h-auto cursor-move p-0 hover:bg-transparent"
								size="sm"
								variant="ghost"
							>
								<IconGripVertical className="h-4 w-4 text-muted-foreground" />
							</Button>
						),
						enableSorting: false,
					} as ColumnDef<ExchangeRate>,
				]
			: []),
		{
			id: "favorite",
			header: () => <span className="sr-only">Favorite</span>,
			enableSorting: false,
			cell: ({ row }) => {
				const { currency, id, isFavorite } = row.original;
				const isLoading = favoriteLoadingId === id;

				return (
					<Button
						aria-label={
							isFavorite
								? `Remove ${currency} from favorites`
								: `Add ${currency} to favorites`
						}
						className="p-0"
						disabled={isLoading}
						onClick={() => void onToggleFavorite(id)}
						size="sm"
						variant="ghost"
					>
						<Heart
							className={cn(
								"h-5 w-5 transition",
								isFavorite
									? "text-destructive"
									: "text-muted-foreground/70 hover:text-muted-foreground",
							)}
							fill={isFavorite ? "currentColor" : "none"}
						/>
					</Button>
				);
			},
		},
		{
			accessorKey: "currency",
			header: "Currency",
			enableSorting: true,
			cell: ({ row }) => {
				const currencyCode = row.original.currency;
				const currencyName = getCurrencyName(currencyCode);
				return (
					<div className="flex items-center gap-3">
						<CurrencyFlag className="!h-8 !w-8" currencyCode={currencyCode} />
						<div className="space-y-0.5">
							<div className="font-medium tabular-nums">{currencyCode}</div>
							<div className="text-muted-foreground text-xs">
								{currencyName}
							</div>
						</div>
					</div>
				);
			},
		},
		{
			accessorKey: "rate",
			header: "Rate (USD)",
			enableSorting: true,
			cell: ({ row }) => {
				const rate = row.original.rate;
				return (
					<div className="text-right tabular-nums">
						{rate.toLocaleString(undefined, {
							minimumFractionDigits: 4,
							maximumFractionDigits: 4,
						})}
					</div>
				);
			},
		},
		{
			accessorKey: "type",
			header: "Type",
			enableSorting: true,
			cell: ({ row }) => {
				const type = row.original.type;
				return (
					<div className="text-sm">
						<span className="capitalize">{type}</span>
					</div>
				);
			},
		},
	];
}

interface DraggableRowProps extends React.ComponentProps<typeof TableRow> {
	id: string;
}

function DraggableRow({
	id,
	className,
	children,
	...props
}: DraggableRowProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 1 : 0,
		position: isDragging ? ("relative" as const) : undefined,
	};

	return (
		<TableRow
			className={cn(className, isDragging && "bg-muted/50 shadow-sm")}
			ref={setNodeRef}
			style={style}
			{...props}
		>
			{/* Apply drag listeners only to the drag handle cell (first child) */}
			{React.Children.map(children, (child, index) => {
				if (index === 0 && React.isValidElement(child)) {
					return React.cloneElement(child, {
						...attributes,
						...listeners,
					});
				}
				return child;
			})}
		</TableRow>
	);
}

interface ExchangeRatesTableProps {
	data: ExchangeRate[];
	onToggleFavorite: (id: string) => Promise<void>;
	onReorder?: (ids: string[]) => void;
	isReorderable?: boolean;
}

export function ExchangeRatesTable({
	data,
	onToggleFavorite,
	onReorder,
	isReorderable = false,
}: ExchangeRatesTableProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [favoriteLoadingId, setFavoriteLoadingId] = useState<string | null>(
		null,
	);

	const transformedData = useMemo(
		() =>
			data.map((rate) => ({
				...rate,
				rate: Number(rate.rate), // Convert Decimal to number
			})),
		[data],
	);

	const filteredData = useMemo(() => {
		if (!searchQuery.trim()) {
			return transformedData;
		}

		const query = searchQuery.toLowerCase();
		return transformedData.filter((rate) => {
			const currencyCode = rate.currency.toLowerCase();
			const currencyName = getCurrencyName(rate.currency).toLowerCase();
			const currencyType = rate.type.toLowerCase();

			return (
				currencyCode.includes(query) ||
				currencyName.includes(query) ||
				currencyType.includes(query)
			);
		});
	}, [transformedData, searchQuery]);

	const handleToggleFavorite = useCallback(
		async (id: string) => {
			setFavoriteLoadingId(id);
			try {
				await onToggleFavorite(id);
			} finally {
				setFavoriteLoadingId((prev) => (prev === id ? null : prev));
			}
		},
		[onToggleFavorite],
	);

	const columns = useMemo(
		() =>
			createExchangeRateColumns({
				onToggleFavorite: handleToggleFavorite,
				favoriteLoadingId,
				isDraggable: isReorderable && !searchQuery, // Only draggable if not searching
			}),
		[favoriteLoadingId, handleToggleFavorite, isReorderable, searchQuery],
	);

	const table = useReactTable({
		data: filteredData,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		initialState: {
			sorting: isReorderable
				? [] // No sorting when reorderable to respect drag order
				: [
						{
							id: "currency",
							desc: false,
						},
					],
			pagination: {
				pageSize: DEFAULT_PAGE_SIZE,
			},
		},
	});

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		if (over && active.id !== over.id) {
			const oldIndex = data.findIndex((item) => item.id === active.id);
			const newIndex = data.findIndex((item) => item.id === over.id);

			if (oldIndex !== -1 && newIndex !== -1) {
				const newDataIds = arrayMove(
					data.map((item) => item.id),
					oldIndex,
					newIndex,
				);
				onReorder?.(newDataIds);
			}
		}
	};

	return (
		<div className="w-full space-y-4">
			<TableSearch
				onChange={setSearchQuery}
				placeholder="Search currencies..."
				value={searchQuery}
			/>
			<div className="max-h-[48rem] overflow-x-auto overflow-y-auto rounded-lg border">
				<DndContext
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
					sensors={sensors}
				>
					<Table>
						<TableHeader className="sticky top-0 z-10 bg-background">
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow
									className="border-b hover:bg-transparent"
									key={headerGroup.id}
								>
									{headerGroup.headers.map((header) => {
										const canSort = header.column.getCanSort();
										const sortDirection = header.column.getIsSorted() as
											| "asc"
											| "desc"
											| false;

										const sortIcon = canSort ? (
											sortDirection ? (
												sortDirection === "asc" ? (
													<IconChevronUp className="h-3 w-3" />
												) : (
													<IconChevronDown className="h-3 w-3" />
												)
											) : (
												<div className="flex flex-col items-center text-muted-foreground/30">
													<IconChevronUp className="h-3 w-3" />
													<IconChevronDown className="-mt-1 h-3 w-3" />
												</div>
											)
										) : null;

										return (
											<TableHead
												className={cn(
													"bg-background px-4 py-3",
													header.id === "favorite" &&
														"w-12 pr-0 pl-4 text-center align-middle",
													header.id === "drag" && "w-10 px-2",
												)}
												key={header.id}
												onClick={
													canSort
														? header.column.getToggleSortingHandler()
														: undefined
												}
											>
												{header.isPlaceholder ? null : (
													<div
														className={cn(
															"flex select-none items-center justify-between gap-2 rounded-md transition-colors",
															canSort && "cursor-pointer",
														)}
													>
														<span className="flex-1 truncate font-medium">
															{flexRender(
																header.column.columnDef.header,
																header.getContext(),
															)}
														</span>
														{sortIcon && (
															<span className="flex flex-shrink-0 items-center text-muted-foreground/50">
																{sortIcon}
															</span>
														)}
													</div>
												)}
											</TableHead>
										);
									})}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{isReorderable && !searchQuery ? (
								<SortableContext
									items={filteredData.map((d) => d.id)}
									strategy={verticalListSortingStrategy}
								>
									{table.getRowModel().rows?.length ? (
										table.getRowModel().rows.map((row) => (
											<DraggableRow id={row.original.id} key={row.id}>
												{row.getVisibleCells().map((cell) => (
													<TableCell
														className={cn(
															"px-4 py-3",
															cell.column.id === "favorite" &&
																"w-12 pr-0 pl-4 text-center align-middle",
															cell.column.id === "drag" &&
																"w-10 px-2 text-center",
														)}
														key={cell.id}
													>
														{flexRender(
															cell.column.columnDef.cell,
															cell.getContext(),
														)}
													</TableCell>
												))}
											</DraggableRow>
										))
									) : (
										<TableRow>
											<TableCell
												className="h-24 text-center"
												colSpan={columns.length}
											>
												No exchange rates found.
											</TableCell>
										</TableRow>
									)}
								</SortableContext>
							) : table.getRowModel().rows?.length ? (
								table.getRowModel().rows.map((row) => (
									<TableRow key={row.id}>
										{row.getVisibleCells().map((cell) => (
											<TableCell
												className={cn(
													"px-4 py-3",
													cell.column.id === "favorite" &&
														"w-12 pr-0 pl-4 text-center align-middle",
												)}
												key={cell.id}
											>
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</TableCell>
										))}
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell
										className="h-24 text-center"
										colSpan={columns.length}
									>
										No exchange rates found.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</DndContext>
			</div>
			<TablePagination table={table} />
		</div>
	);
}

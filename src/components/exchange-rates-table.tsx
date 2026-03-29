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
	ChevronDown,
	ChevronRight,
	GripVertical,
} from "lucide-react";
import {
	type ColumnDef,
	flexRender,
	type Row,
} from "@tanstack/react-table";
import {
	Calculator,
	ChartLine,
	Copy,
	Heart,
	HeartOff,
	HeartPlus,
	MoreHorizontal,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { TableCell, TableRow } from "~/components/ui/table";
import {
	getRateTypeLabel,
	groupRatesByCurrency,
} from "~/lib/exchange-rates-shared";
import { isCrypto } from "~/lib/currency-format";
import { cn, getCurrencyName } from "~/lib/utils";
import { DataTable } from "./data-table";
import { ExpandableSearch } from "./table-search";

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
	subRows?: ExchangeRate[];
};

// ---- Column definitions ----

// ---- Shared menu items ----

interface MenuItemsProps {
	row: Row<ExchangeRate>;
	onRowClick?: (currency: string) => void;
	onToggleFavorite: (id: string) => Promise<void>;
	Item: React.ComponentType<React.ComponentProps<typeof ContextMenuItem>>;
	Separator: React.ComponentType<React.ComponentProps<typeof ContextMenuSeparator>>;
}

function renderMenuItems({
	row,
	onRowClick,
	onToggleFavorite,
	Item,
	Separator,
}: MenuItemsProps) {
	const isSubRow = row.depth > 0;
	const { id, currency, rate, isFavorite } = row.original;

	const handleCopyRate = () => {
		void navigator.clipboard.writeText(
			rate.toLocaleString(undefined, {
				minimumFractionDigits: 4,
				maximumFractionDigits: 4,
			}),
		);
		toast.success(`Copied ${currency} rate to clipboard`);
	};

	return (
		<>
			<Item onClick={handleCopyRate}>
				<Copy />
				Copy rate
			</Item>
			{!isCrypto(currency) && (
				<Item
					onClick={() =>
						window.open(
							`https://www.xe.com/currencycharts/?from=USD&to=${currency}&view=2Y`,
							"_blank",
							"noopener,noreferrer",
						)
					}
				>
					<ChartLine />
					View rate history
				</Item>
			)}
			{!isSubRow && onRowClick && (
				<Item onClick={() => onRowClick(currency)}>
					<Calculator />
					Open in calculator
				</Item>
			)}
			{!isSubRow && (
				<>
					<Separator />
					<Item
						variant={isFavorite ? "destructive" : "default"}
						onClick={() => void onToggleFavorite(id)}
					>
						{isFavorite ? <HeartOff /> : <HeartPlus />}
						{isFavorite ? "Unfavorite" : "Add to favorites"}
					</Item>
				</>
			)}
		</>
	);
}

interface ExchangeRateColumnOptions {
	onToggleFavorite: (id: string) => Promise<void>;
	onRowClick?: (currency: string) => void;
	favoriteLoadingId: string | null;
	isDraggable: boolean;
	grouped: boolean;
}

function createExchangeRateColumns({
	onToggleFavorite,
	onRowClick,
	favoriteLoadingId,
	isDraggable,
	grouped,
}: ExchangeRateColumnOptions): ColumnDef<ExchangeRate>[] {
	return [
		...(isDraggable
			? [
					{
						id: "drag",
						header: () => <span className="sr-only">Move</span>,
						size: 40,
						cell: () => (
							<Button
								className="h-auto cursor-move p-0 hover:bg-transparent"
								size="sm"
								variant="ghost"
							>
								<GripVertical className="h-4 w-4 text-muted-foreground" />
							</Button>
						),
						enableSorting: false,
					} as ColumnDef<ExchangeRate>,
				]
			: []),
		...(grouped
			? [
					{
						id: "expand",
						header: () => null,
						size: 40,
						enableSorting: false,
						cell: ({ row }: { row: Row<ExchangeRate> }) => {
							if (!row.getCanExpand()) return null;
							return (
								<Button
									className="h-auto p-0 hover:bg-transparent"
									onClick={(e) => {
										e.stopPropagation();
										row.toggleExpanded();
									}}
									size="sm"
									variant="ghost"
								>
									{row.getIsExpanded() ? (
										<ChevronDown className="h-4 w-4 text-muted-foreground" />
									) : (
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									)}
								</Button>
							);
						},
					} as ColumnDef<ExchangeRate>,
				]
			: []),
		{
			id: "favorite",
			header: () => <span className="sr-only">Favorite</span>,
			size: 48,
			enableSorting: false,
			cell: ({ row }) => {
				if (row.depth > 0) return null;

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
						onClick={(e) => {
							e.stopPropagation();
							void onToggleFavorite(id);
						}}
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
			meta: { flex: true },
			enableSorting: true,
			cell: ({ row }) => {
				if (row.depth > 0) {
					return (
						<div className="pl-8 text-muted-foreground text-sm">
							{getRateTypeLabel(row.original.type)}
						</div>
					);
				}

				const currencyCode = row.original.currency;
				const currencyName = getCurrencyName(currencyCode);
				return (
					<div className="flex items-center gap-3">
						<CurrencyFlag className="!h-8 !w-8" currencyCode={currencyCode} />
						<div className="space-y-0.5">
							<div className="flex items-center gap-2">
								<span className="font-medium tabular-nums">
									{currencyCode}
								</span>
								{grouped && row.original.subRows && (
									<span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
										{getRateTypeLabel(row.original.type)}
									</span>
								)}
							</div>
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
			size: 140,
			enableSorting: true,
			cell: ({ row }) => {
				const rate = row.original.rate;
				return (
					<div
						className={cn(
							"font-medium text-right tabular-nums",
							row.depth > 0 && "text-muted-foreground",
						)}
					>
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
			size: 120,
			enableSorting: true,
			meta: { className: "hidden md:table-cell" },
			cell: ({ row }) => {
				if (grouped && row.depth === 0 && row.original.subRows) return null;

				const type = row.original.type;
				return (
					<div
						className={cn(row.depth > 0 && "text-muted-foreground")}
					>
						<span className="capitalize">{type}</span>
					</div>
				);
			},
		},
		{
			id: "actions",
			header: () => null,
			size: 48,
			enableSorting: false,
			enableHiding: false,
			cell: ({ row }) => (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100 data-[state=open]:opacity-100"
							size="icon"
							variant="ghost"
							onClick={(e) => e.stopPropagation()}
						>
							<MoreHorizontal className="h-4 w-4" />
							<span className="sr-only">Actions</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						{renderMenuItems({
							row,
							onRowClick,
							onToggleFavorite,
							Item: DropdownMenuItem,
							Separator: DropdownMenuSeparator,
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];
}

// ---- Draggable row ----

interface DraggableRowProps extends React.ComponentProps<typeof TableRow> {
	id: string;
}

const DraggableRow = React.forwardRef<
	HTMLTableRowElement,
	DraggableRowProps
>(function DraggableRow({ id, className, children, ...props }, forwardedRef) {
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
			ref={(node) => {
				setNodeRef(node);
				if (typeof forwardedRef === "function") forwardedRef(node);
				else if (forwardedRef) forwardedRef.current = node;
			}}
			style={style}
			{...props}
		>
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
});

// ---- Shared row rendering helpers ----

function renderCells(row: Row<ExchangeRate>) {
	return row.getVisibleCells().map((cell) => {
		const meta = cell.column.columnDef.meta as Record<string, unknown> | undefined;
		const hasFixedSize =
			cell.column.columnDef.size != null && !meta?.flex;

		return (
			<TableCell
				className={cn("px-4 py-3", meta?.className as string)}
				key={cell.id}
				style={
					hasFixedSize
						? {
								width: cell.column.getSize(),
								minWidth: cell.column.getSize(),
							}
						: undefined
				}
			>
				{flexRender(cell.column.columnDef.cell, cell.getContext())}
			</TableCell>
		);
	});
}

// ---- Main component ----

interface ExchangeRatesTableProps {
	data: ExchangeRate[];
	onToggleFavorite: (id: string) => Promise<void>;
	onReorder?: (ids: string[]) => void;
	isReorderable?: boolean;
	grouped?: boolean;
	onRowClick?: (currency: string) => void;
}

export function ExchangeRatesTable({
	data,
	onToggleFavorite,
	onReorder,
	isReorderable = false,
	grouped = false,
	onRowClick,
}: ExchangeRatesTableProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [favoriteLoadingId, setFavoriteLoadingId] = useState<string | null>(
		null,
	);

	const transformedData = useMemo(
		() =>
			data.map((rate) => ({
				...rate,
				rate: Number(rate.rate),
			})),
		[data],
	);

	// Filter externally - DataTable's globalFilter doesn't search sub-rows
	const filteredData = useMemo(() => {
		if (!searchQuery.trim()) return transformedData;

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

	const tableData = useMemo(() => {
		if (!grouped) return filteredData;
		return groupRatesByCurrency(filteredData);
	}, [filteredData, grouped]);

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

	const isDraggable = isReorderable && !searchQuery;

	const columns = useMemo(
		() =>
			createExchangeRateColumns({
				onToggleFavorite: handleToggleFavorite,
				onRowClick,
				favoriteLoadingId,
				isDraggable,
				grouped,
			}),
		[favoriteLoadingId, handleToggleFavorite, onRowClick, isDraggable, grouped],
	);

	// ---- Drag-and-drop ----

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
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
		},
		[data, onReorder],
	);

	// ---- Context menu ----

	const renderContextMenuContent = useCallback(
		(row: Row<ExchangeRate>) => (
			<ContextMenuContent>
				{renderMenuItems({
					row,
					onRowClick,
					onToggleFavorite: handleToggleFavorite,
					Item: ContextMenuItem,
					Separator: ContextMenuSeparator,
				})}
			</ContextMenuContent>
		),
		[onRowClick, handleToggleFavorite],
	);

	// ---- Row renderers ----

	const renderDraggableRow = useCallback(
		(row: Row<ExchangeRate>) => (
			<ContextMenu key={row.id}>
				<ContextMenuTrigger asChild>
					<DraggableRow
						id={row.original.id}
						className={cn("group", onRowClick && "cursor-pointer")}
						onClick={() => onRowClick?.(row.original.currency)}
					>
						{renderCells(row)}
					</DraggableRow>
				</ContextMenuTrigger>
				{renderContextMenuContent(row)}
			</ContextMenu>
		),
		[onRowClick, renderContextMenuContent],
	);

	const renderGroupedRow = useCallback(
		(row: Row<ExchangeRate>) => {
			const isSubRow = row.depth > 0;
			return (
				<ContextMenu key={row.id}>
					<ContextMenuTrigger asChild>
						<TableRow
							className={cn(
								"group",
								onRowClick && !isSubRow && "cursor-pointer transition-colors",
								isSubRow && "bg-muted/30",
							)}
							onClick={() => {
								if (!isSubRow && onRowClick) {
									onRowClick(row.original.currency);
								}
							}}
						>
							{renderCells(row)}
						</TableRow>
					</ContextMenuTrigger>
					{renderContextMenuContent(row)}
				</ContextMenu>
			);
		},
		[onRowClick, renderContextMenuContent],
	);

	// ---- Wrap table body content for SortableContext ----

	const renderTableBodyContent = useCallback(
		(children: React.ReactNode) => (
			<SortableContext
				items={filteredData.map((d) => d.id)}
				strategy={verticalListSortingStrategy}
			>
				{children}
			</SortableContext>
		),
		[filteredData],
	);

	const initialSorting = useMemo(
		() =>
			isReorderable ? [] : [{ id: "currency" as const, desc: false }],
		[isReorderable],
	);

	// ---- Render ----

	const table = (
		<DataTable<ExchangeRate>
			data={tableData}
			columns={columns}
			searchable={false}
			hideCount
			progressive
			fillHeight
			initialSorting={initialSorting}
			emptyState={
				<div className="py-8 text-muted-foreground text-sm">
					No exchange rates found.
				</div>
			}
			renderRow={isDraggable ? renderDraggableRow : renderGroupedRow}
			{...(isDraggable
				? { renderTableBodyContent }
				: {})}
			{...(grouped
				? { getSubRows: (row: ExchangeRate) => row.subRows }
				: {})}
		/>
	);

	const rateCountLabel = filteredData.length === 1
		? "1 currency"
		: `${filteredData.length} currencies`;

	return (
		<div className="flex flex-col flex-1 min-h-0 gap-4">
			<div className="flex items-center gap-2">
				<span className="shrink-0 tabular-nums text-muted-foreground text-sm">
					{rateCountLabel}
				</span>
				<ExpandableSearch
					onChange={setSearchQuery}
					placeholder="Search currencies..."
					value={searchQuery}
					captureTyping
					slashFocus
				/>
			</div>
			{isDraggable ? (
				<DndContext
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
					sensors={sensors}
				>
					{table}
				</DndContext>
			) : (
				table
			)}
		</div>
	);
}

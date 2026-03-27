"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	type DraggableAttributes,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
	arrayMove,
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ArrowDownToLine, ArrowUpToLine, Calculator, Copy, Heart, HeartOff } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import type { FavoriteCurrencyCardData } from "~/hooks/use-exchange-rates-controller";
import { getCurrencyName } from "~/lib/currency-format";
import { getDisplayRate } from "~/lib/currency-math";
import { getRateTypeLabel } from "~/lib/exchange-rates-shared";
import { cn } from "~/lib/utils";

interface FavoriteCurrencyCardsProps {
	cards: FavoriteCurrencyCardData[];
	onCardClick?: (currency: string) => void;
	onUnfavorite: (currency: string) => Promise<void>;
	onReorder: (ids: string[]) => void;
	variant?: "default" | "compact";
}

interface CardActions {
	onCardClick?: (currency: string) => void;
	onUnfavorite: (currency: string) => Promise<void>;
	onMoveToTop: (primaryRateId: string) => void;
	onMoveToBottom: (primaryRateId: string) => void;
}

export function FavoriteCurrencyCards({
	cards,
	onCardClick,
	onUnfavorite,
	onReorder,
	variant = "default",
}: FavoriteCurrencyCardsProps) {
	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const sortableIds = cards.map((c) => c.primaryRateId);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;

			const oldIndex = sortableIds.indexOf(active.id as string);
			const newIndex = sortableIds.indexOf(over.id as string);
			if (oldIndex === -1 || newIndex === -1) return;

			const newIds = arrayMove(sortableIds, oldIndex, newIndex);
			onReorder(newIds);
		},
		[sortableIds, onReorder],
	);

	const handleMoveToTop = useCallback(
		(primaryRateId: string) => {
			const idx = sortableIds.indexOf(primaryRateId);
			if (idx <= 0) return;
			const newIds = arrayMove(sortableIds, idx, 0);
			onReorder(newIds);
		},
		[sortableIds, onReorder],
	);

	const handleMoveToBottom = useCallback(
		(primaryRateId: string) => {
			const idx = sortableIds.indexOf(primaryRateId);
			if (idx === -1 || idx === sortableIds.length - 1) return;
			const newIds = arrayMove(sortableIds, idx, sortableIds.length - 1);
			onReorder(newIds);
		},
		[sortableIds, onReorder],
	);

	const isCompact = variant === "compact";

	if (cards.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-muted">
				<EmptyState
					className={isCompact ? "py-4" : "py-8"}
					description="Tap the heart icon on any currency to pin it here."
					icon={Heart}
					title="No Favorites Yet"
				/>
			</div>
		);
	}

	return (
		<DndContext
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
			sensors={sensors}
		>
			<SortableContext
				items={sortableIds}
				strategy={isCompact ? verticalListSortingStrategy : rectSortingStrategy}
			>
				<div className={isCompact
					? "flex flex-col gap-2"
					: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
				}>
					{cards.map((card) => (
						<SortableFavoriteCard
							card={card}
							compact={isCompact}
							key={card.primaryRateId}
							onCardClick={onCardClick}
							onUnfavorite={onUnfavorite}
							onMoveToTop={handleMoveToTop}
							onMoveToBottom={handleMoveToBottom}
						/>
					))}
				</div>
			</SortableContext>
		</DndContext>
	);
}

interface SortableFavoriteCardProps extends CardActions {
	card: FavoriteCurrencyCardData;
	compact?: boolean;
}

function SortableFavoriteCard({
	card,
	compact,
	onCardClick,
	onUnfavorite,
	onMoveToTop,
	onMoveToBottom,
}: SortableFavoriteCardProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: card.primaryRateId });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 10 : 0,
	};

	return (
		<div ref={setNodeRef} style={style}>
			<FavoriteCurrencyCard
				card={card}
				compact={compact}
				dragAttributes={attributes}
				dragListeners={listeners}
				isDragging={isDragging}
				onCardClick={onCardClick}
				onUnfavorite={onUnfavorite}
				onMoveToTop={onMoveToTop}
				onMoveToBottom={onMoveToBottom}
			/>
		</div>
	);
}

interface FavoriteCurrencyCardProps extends CardActions {
	card: FavoriteCurrencyCardData;
	compact?: boolean;
	isDragging?: boolean;
	dragAttributes?: DraggableAttributes;
	dragListeners?: SyntheticListenerMap;
}

function FavoriteCurrencyCard({
	card,
	compact,
	onCardClick,
	onUnfavorite,
	onMoveToTop,
	onMoveToBottom,
	isDragging,
	dragAttributes,
	dragListeners,
}: FavoriteCurrencyCardProps) {
	const [isUnfavoriting, setIsUnfavoriting] = useState(false);

	const handleUnfavorite = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			setIsUnfavoriting(true);
			try {
				await onUnfavorite(card.currency);
			} finally {
				setIsUnfavoriting(false);
			}
		},
		[onUnfavorite, card.currency],
	);

	const handleCopyRate = useCallback(() => {
		const primaryRate = card.rateTypes[0];
		if (!primaryRate) return;
		const displayVal = getDisplayRate(primaryRate.rate, card.currency);
		void navigator.clipboard.writeText(
			displayVal.toLocaleString(undefined, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 4,
			}),
		);
		toast.success(`Copied ${card.currency} rate to clipboard`);
	}, [card]);

	const contextMenuContent = (
		<ContextMenuContent>
			{onCardClick && (
				<ContextMenuItem onClick={() => onCardClick(card.currency)}>
					<Calculator />
					Open in calculator
				</ContextMenuItem>
			)}
			<ContextMenuItem onClick={handleCopyRate}>
				<Copy />
				Copy rate
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onClick={() => onMoveToTop(card.primaryRateId)}>
				<ArrowUpToLine />
				Move to top
			</ContextMenuItem>
			<ContextMenuItem onClick={() => onMoveToBottom(card.primaryRateId)}>
				<ArrowDownToLine />
				Move to bottom
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				variant="destructive"
				onClick={() => void onUnfavorite(card.currency)}
			>
				<HeartOff />
				Unfavorite
			</ContextMenuItem>
		</ContextMenuContent>
	);

	if (compact) {
		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<Card
						className={cn(
							"transition-shadow",
							onCardClick && "cursor-pointer hover:shadow-md",
							isDragging && "shadow-lg",
						)}
						onClick={() => onCardClick?.(card.currency)}
					>
						<CardContent className="p-3">
							<div className="flex items-center gap-2">
								<button
									className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground"
									type="button"
									{...dragAttributes}
									{...dragListeners}
								>
									<GripVertical className="h-3.5 w-3.5" />
								</button>
								<CurrencyFlag className="!h-5 !w-5 shrink-0" currencyCode={card.currency} />
								<span className="text-sm font-medium">{card.currency}</span>
								<span className="truncate text-muted-foreground text-xs">
									{getCurrencyName(card.currency)}
								</span>
								<Button
									aria-label={`Remove ${card.currency} from favorites`}
									className="ml-auto shrink-0 h-6 w-6 p-0"
									disabled={isUnfavoriting}
									onClick={handleUnfavorite}
									size="icon"
									variant="ghost"
								>
									<Heart
										className="h-3.5 w-3.5 text-destructive transition"
										fill="currentColor"
									/>
								</Button>
							</div>
							{card.rateTypes.length > 0 && (
								<div className="mt-1.5 ml-[22px] space-y-0.5">
									{card.rateTypes.map((rt) => {
										const displayVal = getDisplayRate(rt.rate, card.currency);
										return (
											<div
												className="flex items-center justify-between text-xs"
												key={rt.id}
											>
												<span className="text-muted-foreground">
													{getRateTypeLabel(rt.type)}
												</span>
												<span className="tabular-nums">
													{displayVal.toLocaleString(undefined, {
														minimumFractionDigits: 2,
														maximumFractionDigits: 4,
													})}
												</span>
											</div>
										);
									})}
								</div>
							)}
						</CardContent>
					</Card>
				</ContextMenuTrigger>
				{contextMenuContent}
			</ContextMenu>
		);
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<Card
					className={cn(
						"transition-shadow",
						onCardClick && "cursor-pointer hover:shadow-md",
						isDragging && "shadow-lg",
					)}
					onClick={() => onCardClick?.(card.currency)}
				>
					<CardContent className="p-4">
						{/* Header: drag handle + flag + code + name + heart */}
						<div className="mb-3 flex items-center gap-2">
							<button
								className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground"
								type="button"
								{...dragAttributes}
								{...dragListeners}
							>
								<GripVertical className="h-4 w-4" />
							</button>
							<CurrencyFlag className="!h-8 !w-8 shrink-0" currencyCode={card.currency} />
							<div className="min-w-0 flex-1">
								<div className="font-medium">{card.currency}</div>
								<div className="truncate text-muted-foreground text-xs">
									{getCurrencyName(card.currency)}
								</div>
							</div>
							<Button
								aria-label={`Remove ${card.currency} from favorites`}
								className="shrink-0 p-0"
								disabled={isUnfavoriting}
								onClick={handleUnfavorite}
								size="sm"
								variant="ghost"
							>
								<Heart
									className="h-5 w-5 text-destructive transition"
									fill="currentColor"
								/>
							</Button>
						</div>

						{/* Rate types list */}
						<div className="space-y-1.5">
							{card.rateTypes.map((rt) => {
								const displayVal = getDisplayRate(rt.rate, card.currency);
								return (
									<div
										className="flex items-center justify-between text-sm"
										key={rt.id}
									>
										<span className="text-muted-foreground">
											{getRateTypeLabel(rt.type)}
										</span>
										<span className="tabular-nums">
											{displayVal.toLocaleString(undefined, {
												minimumFractionDigits: 2,
												maximumFractionDigits: 4,
											})}
										</span>
									</div>
								);
							})}
						</div>
					</CardContent>
				</Card>
			</ContextMenuTrigger>
			{contextMenuContent}
		</ContextMenu>
	);
}

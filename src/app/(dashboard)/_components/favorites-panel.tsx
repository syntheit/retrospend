"use client";

import { formatDistanceToNow } from "date-fns";
import { Copy, ExternalLink, HeartOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { Skeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";

interface FavoritesPanelProps {
	favoritesLoading: boolean;
	favoriteRates: Array<{
		id: string;
		currency: string;
		type: string;
		rate: number;
		date: Date;
	}>;
	isUsingMockFavorites: boolean;
}

export function FavoritesPanel({
	favoritesLoading,
	favoriteRates,
	isUsingMockFavorites,
}: FavoritesPanelProps) {
	const utils = api.useUtils();

	const toggleFavoriteMutation = api.preferences.toggleFavoriteExchangeRate.useMutation({
		onSuccess: () => {
			void utils.dashboard.getOverviewData.invalidate();
		},
	});

	const handleUnfavorite = (id: string) => {
		toggleFavoriteMutation.mutate({ exchangeRateId: id });
	};

	const latestUpdate =
		favoriteRates.length > 0
			? new Date(Math.max(...favoriteRates.map((r) => r.date.getTime())))
			: null;

	return (
		<Card className="border border-border bg-card shadow-sm lg:flex lg:flex-col lg:h-full">
			<CardHeader>
				<CardTitle className="font-semibold text-lg">Currencies</CardTitle>
				<CardDescription>
					{latestUpdate
						? `Live Rates • Updated ${formatDistanceToNow(latestUpdate, { addSuffix: true })}`
						: "Favorite exchange rates"}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3 overflow-y-auto lg:flex-1 lg:min-h-0">
				<FavoritesContent
					isLoading={favoritesLoading}
					isMock={isUsingMockFavorites}
					onUnfavorite={handleUnfavorite}
					rates={favoriteRates}
				/>
			</CardContent>
		</Card>
	);
}

function FavoritesContent({
	isLoading,
	rates,
	isMock,
	onUnfavorite,
}: {
	isLoading: boolean;
	rates: FavoritesPanelProps["favoriteRates"];
	isMock: boolean;
	onUnfavorite: (id: string) => void;
}) {
	if (isLoading) {
		return <FavoritesLoading />;
	}

	if (rates.length === 0) {
		return <FavoritesEmpty />;
	}

	return <FavoritesList isMock={isMock} onUnfavorite={onUnfavorite} rates={rates} />;
}

function FavoritesLoading() {
	return (
		<div className="space-y-2">
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-12 w-full" />
		</div>
	);
}

function FavoritesEmpty() {
	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
			<div className="font-medium">
				Star currencies in Settings to track them here.
			</div>
			<Button asChild size="sm" variant="outline">
				<Link href="/settings">Open settings</Link>
			</Button>
		</div>
	);
}

function FavoritesList({
	rates,
	isMock,
	onUnfavorite,
}: {
	rates: FavoritesPanelProps["favoriteRates"];
	isMock: boolean;
	onUnfavorite: (id: string) => void;
}) {
	return (
		<div className="space-y-2">
			{rates.map((rate) => (
				<FavoriteItem key={rate.id} onUnfavorite={onUnfavorite} rate={rate} />
			))}
			{isMock && (
				<p className="text-muted-foreground text-xs">
					Using sample data until favorites are added.
				</p>
			)}
		</div>
	);
}

function FavoriteItem({
	rate,
	onUnfavorite,
}: {
	rate: FavoritesPanelProps["favoriteRates"][number];
	onUnfavorite: (id: string) => void;
}) {
	const handleCopyRate = () => {
		void navigator.clipboard.writeText(
			rate.rate.toLocaleString(undefined, { maximumFractionDigits: 4 }),
		);
		toast.success(`Copied ${rate.currency} rate to clipboard`);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div className="-mx-2 flex items-center justify-between rounded border-border border-b px-2 py-3 transition-colors last:border-0 hover:bg-accent/50">
					<div>
						<div className="flex items-center gap-2">
							<CurrencyFlag className="!h-6 !w-6" currencyCode={rate.currency} />
							<span className="font-semibold tabular-nums">{rate.currency}</span>
							<Badge className="capitalize" variant="secondary">
								{rate.type}
							</Badge>
						</div>
					</div>
					<div className="text-right font-semibold tabular-nums">
						{rate.rate.toLocaleString(undefined, {
							maximumFractionDigits: 4,
						})}
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={handleCopyRate}>
					<Copy />
					Copy rate
				</ContextMenuItem>
				<ContextMenuItem asChild>
					<Link href="/currencies">
						<ExternalLink />
						Go to currencies
					</Link>
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem variant="destructive" onClick={() => onUnfavorite(rate.id)}>
					<HeartOff />
					Unfavorite
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

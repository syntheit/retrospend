"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";

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
	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-semibold text-lg">Exchange Rates</CardTitle>
				<CardDescription>Favorite exchange rates</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 space-y-3 overflow-y-auto">
				<FavoritesContent
					isLoading={favoritesLoading}
					isMock={isUsingMockFavorites}
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
}: {
	isLoading: boolean;
	rates: FavoritesPanelProps["favoriteRates"];
	isMock: boolean;
}) {
	if (isLoading) {
		return <FavoritesLoading />;
	}

	if (rates.length === 0) {
		return <FavoritesEmpty />;
	}

	return <FavoritesList isMock={isMock} rates={rates} />;
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
				<Link href="/app/settings">Open settings</Link>
			</Button>
		</div>
	);
}

function FavoritesList({
	rates,
	isMock,
}: {
	rates: FavoritesPanelProps["favoriteRates"];
	isMock: boolean;
}) {
	return (
		<div className="space-y-2">
			{rates.map((rate) => (
				<FavoriteItem key={rate.id} rate={rate} />
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
}: {
	rate: FavoritesPanelProps["favoriteRates"][number];
}) {
	return (
		<div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
			<div>
				<div className="flex items-center gap-2">
					<span className="font-mono font-semibold">{rate.currency}</span>
					<Badge className="capitalize" variant="secondary">
						{rate.type}
					</Badge>
				</div>
				<p className="text-muted-foreground text-xs">
					Updated{" "}
					{formatDistanceToNow(rate.date, {
						addSuffix: true,
					})}
				</p>
			</div>
			<div className="text-right font-semibold">
				{rate.rate.toLocaleString(undefined, {
					maximumFractionDigits: 4,
				})}
			</div>
		</div>
	);
}

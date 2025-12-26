"use client";

import { Edit } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { AssetType } from "~/lib/db-enums";
import { formatCurrencyAmount, getCurrencySymbol } from "~/lib/utils";
import { AssetDialog } from "./asset-dialog";

interface Asset {
	id: string;
	name: string;
	type: AssetType;
	currency: string;
	balance: number;
	balanceInUSD: number;
	exchangeRate?: number;
	exchangeRateType?: string;
	isLiquid: boolean;
}

interface WealthAssetsTableProps {
	assets: Asset[];
}

const getTypeColor = (type: AssetType) => {
	switch (type) {
		case AssetType.CASH:
			return "default";
		case AssetType.INVESTMENT:
			return "secondary";
		case AssetType.CRYPTO:
			return "outline"; // or specific color class if customized
		case AssetType.REAL_ESTATE:
			return "destructive"; // just to distinguish
		default:
			return "default";
	}
};

export function WealthAssetsTable({ assets }: WealthAssetsTableProps) {

	return (
		<Card>
			<CardHeader>
				<CardTitle>Assets</CardTitle>
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<div className="min-w-[600px]">
					<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Type</TableHead>
							<TableHead className="text-right">Balance</TableHead>
							<TableHead>Rate</TableHead>
							<TableHead className="text-right">Value (USD)</TableHead>
							<TableHead className="w-[50px]"></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{assets.map((asset) => (
							<TableRow key={asset.id}>
								<TableCell className="font-medium">{asset.name}</TableCell>
								<TableCell>
									<Badge variant={getTypeColor(asset.type)}>{asset.type}</Badge>
									{asset.isLiquid && (
										<Badge className="ml-2" variant="outline">
											Liquid
										</Badge>
									)}
								</TableCell>
								<TableCell className="text-right">
									{getCurrencySymbol(asset.currency)}
									{formatCurrencyAmount(asset.balance)}
								</TableCell>
								<TableCell>
									{asset.currency !== "USD" && asset.exchangeRateType && (
										<Badge className="text-xs" variant="outline">
											{asset.exchangeRateType.charAt(0).toUpperCase() +
												asset.exchangeRateType.slice(1)}
										</Badge>
									)}
									{asset.currency === "USD" && (
										<span className="text-muted-foreground">-</span>
									)}
								</TableCell>
								<TableCell className="text-right font-medium">
									${formatCurrencyAmount(asset.balanceInUSD)}
								</TableCell>
								<TableCell>
									<AssetDialog
										assetId={asset.id}
										initialValues={{
											name: asset.name,
											type: asset.type,
											currency: asset.currency,
											balance: asset.balance,
											isLiquid: asset.isLiquid,
											exchangeRate: asset.exchangeRate,
											exchangeRateType: asset.exchangeRateType,
										}}
										mode="edit"
										trigger={
											<Button className="h-8 w-8" size="icon" variant="ghost">
												<Edit className="h-4 w-4" />
												<span className="sr-only">Edit asset</span>
											</Button>
										}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}

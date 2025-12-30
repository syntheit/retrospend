"use client";

import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { AssetDialog } from "./asset-dialog";

interface WealthHeaderProps {
	totalNetWorth: number;
}

export function WealthHeader({ totalNetWorth }: WealthHeaderProps) {
	const { formatCurrency } = useCurrencyFormatter();

	return (
		<div className="flex items-center justify-between space-y-2">
			<div>
				<div className="flex items-baseline space-x-2">
					<span className="font-bold text-4xl">
						{formatCurrency(totalNetWorth, "USD")}
					</span>
					<span className="text-muted-foreground text-sm">Net Worth (USD)</span>
				</div>
			</div>
			<div className="flex items-center space-x-2">
				<AssetDialog mode="create" />
			</div>
		</div>
	);
}

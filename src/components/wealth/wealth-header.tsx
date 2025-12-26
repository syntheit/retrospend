"use client";

import { formatCurrencyAmount } from "~/lib/utils";
import { AssetDialog } from "./asset-dialog";

interface WealthHeaderProps {
	totalNetWorth: number;
}

export function WealthHeader({ totalNetWorth }: WealthHeaderProps) {
	return (
		<div className="flex items-center justify-between space-y-2">
			<div>
				<div className="flex items-baseline space-x-2">
					<span className="font-bold text-4xl">
						${formatCurrencyAmount(totalNetWorth)}
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

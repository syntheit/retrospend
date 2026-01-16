"use client";

import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { AssetDialog } from "./asset-dialog";

export function WealthHeader({ hideAddButton }: { hideAddButton?: boolean }) {
	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex items-center gap-4">
				<h1 className="font-bold text-2xl tracking-tight">Wealth</h1>
			</div>

			{/* Primary Action */}
			{!hideAddButton && (
				<AssetDialog
					mode="create"
					trigger={
						<Button>
							<Plus className="mr-2 h-4 w-4" />
							Add Asset
						</Button>
					}
				/>
			)}
		</div>
	);
}

"use client";

import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tip } from "~/components/ui/tooltip";

/**
 * The ⋯ of a settings row, drawn like ActionMenu (ghost icon button with a
 * tooltip). Categories, payment methods, keys and devices have no entry in
 * the action registry yet, so their items are listed here (see the report).
 */
export function MoreMenu({
	label,
	children,
}: {
	/** "Actions for Groceries". */
	label: string;
	/** DropdownMenuItem and DropdownMenuSeparator. */
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<Tip content={label}>
				<DropdownMenuTrigger asChild>
					<Button aria-label={label} icon kind="ghost">
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
			</Tip>
			<DropdownMenuContent align="end">{children}</DropdownMenuContent>
		</DropdownMenu>
	);
}

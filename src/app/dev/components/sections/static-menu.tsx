"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export type StaticMenuEntry =
	| { group: string }
	| { sep: true }
	| {
			label: string;
			icon?: LucideIcon;
			lead?: ReactNode;
			kbd?: string;
			danger?: boolean;
			disabled?: boolean;
	  };

/**
 * A menu held open in place, so the gallery shows it like components.html's
 * static menus. It is the real dropdown-menu primitive, open and non-modal,
 * anchored to the top of a box that keeps room for it.
 */
export function StaticMenu({
	entries,
	height,
	label,
}: {
	entries: StaticMenuEntry[];
	/** Room the open menu needs below its anchor, in px. */
	height: number;
	label: string;
}) {
	return (
		<div className="relative w-60" style={{ height }}>
			<DropdownMenu modal={false} open>
				<DropdownMenuTrigger asChild>
					<span aria-label={label} className="absolute top-0 left-0 size-px" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-60"
					onCloseAutoFocus={(e) => e.preventDefault()}
					onInteractOutside={(e) => e.preventDefault()}
					sideOffset={0}
				>
					{entries.map((e, i) => {
						const key = `${i}`;
						if ("group" in e)
							return (
								<DropdownMenuLabel className="text-fg-3 text-meta" key={key}>
									{e.group}
								</DropdownMenuLabel>
							);
						if ("sep" in e) return <DropdownMenuSeparator key={key} />;
						const Icon = e.icon;
						return (
							<DropdownMenuItem
								disabled={e.disabled}
								key={key}
								variant={e.danger ? "destructive" : "default"}
							>
								{e.lead ?? (Icon ? <Icon aria-hidden="true" /> : null)}
								{e.label}
								{e.kbd ? (
									<DropdownMenuShortcut>{e.kbd}</DropdownMenuShortcut>
								) : null}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

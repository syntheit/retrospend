"use client";

import { EllipsisIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";

import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Entity } from "./registry";
import { type EntityActionProps, useEntityActions } from "./use-entity-actions";

type MenuParts = {
	Item: typeof DropdownMenuItem | typeof ContextMenuItem;
	Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
	Shortcut: typeof DropdownMenuShortcut | typeof ContextMenuShortcut;
};

/** The same items for the ⋯ menu and the context menu: one list, two triggers. */
function Items({
	actions,
	parts: { Item, Separator, Shortcut },
}: {
	actions: ReturnType<typeof useEntityActions>;
	parts: MenuParts;
}) {
	return actions.entries.map((entry) =>
		entry.kind === "separator" ? (
			<Separator key={entry.key} />
		) : (
			<Item
				key={entry.action.id}
				onSelect={() => actions.run(entry.action)}
				variant={entry.action.danger ? "destructive" : "default"}
			>
				<entry.action.icon aria-hidden="true" />
				{actions.label(entry.action)}
				{entry.action.kbd ? <Shortcut>{entry.action.kbd}</Shortcut> : null}
			</Item>
		),
	);
}

/**
 * ActionMenu: the ⋯ button of an entity row or page header. Its items come
 * from the entity's registry (src/components/actions/registry.ts).
 */
export function ActionMenu<E extends Entity>(
	props: EntityActionProps<E> & { align?: "start" | "end" },
) {
	const t = useTranslations("overlays.menu");
	const actions = useEntityActions(props);
	if (actions.entries.length === 0) return null;
	return (
		<>
			<DropdownMenu>
				<Tip content={t("more", { name: props.target.name })}>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label={t("more", { name: props.target.name })}
							icon
							kind="ghost"
						>
							<EllipsisIcon />
						</Button>
					</DropdownMenuTrigger>
				</Tip>
				<DropdownMenuContent align={props.align ?? "end"}>
					<Items
						actions={actions}
						parts={{
							Item: DropdownMenuItem,
							Separator: DropdownMenuSeparator,
							Shortcut: DropdownMenuShortcut,
						}}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
			{actions.confirm}
		</>
	);
}

/**
 * ActionArea wraps a row: right-click (fine pointers) and long press
 * (touch) open the same menu as its ⋯ button, and the menu's letter hints
 * work while the row has focus. The row itself stays the child element.
 */
export function ActionArea<E extends Entity>({
	children,
	...props
}: EntityActionProps<E> & { children: React.ReactElement }) {
	const actions = useEntityActions(props);
	if (actions.entries.length === 0) return children;
	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild onKeyDown={actions.onRowKeyDown}>
					{children}
				</ContextMenuTrigger>
				<ContextMenuContent>
					<Items
						actions={actions}
						parts={{
							Item: ContextMenuItem,
							Separator: ContextMenuSeparator,
							Shortcut: ContextMenuShortcut,
						}}
					/>
				</ContextMenuContent>
			</ContextMenu>
			{actions.confirm}
		</>
	);
}

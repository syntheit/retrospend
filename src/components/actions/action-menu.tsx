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
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Entity } from "./registry";
import { type EntityActionProps, useEntityActions } from "./use-entity-actions";

type MenuParts = {
	Item: typeof DropdownMenuItem | typeof ContextMenuItem;
	Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
	Shortcut: typeof DropdownMenuShortcut | typeof ContextMenuShortcut;
	Sub: typeof DropdownMenuSub | typeof ContextMenuSub;
	SubTrigger: typeof DropdownMenuSubTrigger | typeof ContextMenuSubTrigger;
	SubContent: typeof DropdownMenuSubContent | typeof ContextMenuSubContent;
};

const DROPDOWN: MenuParts = {
	Item: DropdownMenuItem,
	Separator: DropdownMenuSeparator,
	Shortcut: DropdownMenuShortcut,
	Sub: DropdownMenuSub,
	SubTrigger: DropdownMenuSubTrigger,
	SubContent: DropdownMenuSubContent,
};

const CONTEXT: MenuParts = {
	Item: ContextMenuItem,
	Separator: ContextMenuSeparator,
	Shortcut: ContextMenuShortcut,
	Sub: ContextMenuSub,
	SubTrigger: ContextMenuSubTrigger,
	SubContent: ContextMenuSubContent,
};

/**
 * The same items for the ⋯ menu and the context menu: one list, two
 * triggers. A pick action opens its choices as a submenu, each with its
 * identity in the one 24px lead slot (R25).
 */
function Items({
	actions,
	parts: { Item, Separator, Shortcut, Sub, SubTrigger, SubContent },
}: {
	actions: ReturnType<typeof useEntityActions>;
	parts: MenuParts;
}) {
	return actions.entries.map((entry) =>
		entry.kind === "separator" ? (
			<Separator key={entry.key} />
		) : entry.action.pick ? (
			<Sub key={entry.action.id}>
				<SubTrigger>
					<entry.action.icon aria-hidden="true" />
					{actions.label(entry.action)}
				</SubTrigger>
				<SubContent>
					{actions.choices?.[entry.action.id]?.map((c) => (
						<Item key={c.id} onSelect={() => actions.pick(entry.action, c.id)}>
							{c.lead != null && (
								<span
									aria-hidden="true"
									className="inline-flex size-6 shrink-0 items-center justify-center"
								>
									{c.lead}
								</span>
							)}
							{c.label}
						</Item>
					))}
				</SubContent>
			</Sub>
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
					<Items actions={actions} parts={DROPDOWN} />
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
					<Items actions={actions} parts={CONTEXT} />
				</ContextMenuContent>
			</ContextMenu>
			{actions.confirm}
		</>
	);
}

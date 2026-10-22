"use client";

import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { CommandGroup, CommandItem } from "~/components/ui/command";
import { Face } from "~/components/ui/avatar-face";
import { PickerGroup, PickerItem, PickerList } from "./picker-list";

export type PickerPerson = {
	id: string;
	name: string;
	avatarUrl?: string | null;
	/** People not on Retrospend get that status word under their name. */
	onRetrospend: boolean;
};

export type PersonPickerProps = {
	people: readonly PickerPerson[];
	value: readonly string[];
	onChange: (ids: string[]) => void;
	/** Shown as "Add {name}" when given; called with what was typed. */
	onAddPerson?: (name: string) => void;
};

/** Selecting toggles one person; the order of the list is kept. */
export function togglePerson(value: readonly string[], id: string): string[] {
	return value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
}

/**
 * PersonPicker: pick people with their faces. Several at once; Enter or a
 * click toggles one. "Not on Retrospend" is a status word, not a ring.
 */
export function PersonPicker({
	people,
	value,
	onChange,
	onAddPerson,
}: PersonPickerProps) {
	const t = useTranslations("pickers.person");
	const [search, setSearch] = React.useState("");
	const typed = search.trim();
	return (
		<PickerList
			empty={t("empty")}
			label={t("label")}
			onSearch={setSearch}
			placeholder={t("find")}
			search={search}
		>
			<PickerGroup heading={t("label")}>
				{people.map((p) => (
					<PickerItem
						key={p.id}
						keywords={[p.name]}
						lead={<Face imageUrl={p.avatarUrl} name={p.name} size="xs" />}
						onSelect={() => onChange(togglePerson(value, p.id))}
						selected={value.includes(p.id)}
						selectedLabel={t("selected")}
						value={p.id}
					>
						{p.name}
						{p.onRetrospend ? null : (
							<span className="block text-fg-3 text-meta">
								{t("notOnRetrospend")}
							</span>
						)}
					</PickerItem>
				))}
			</PickerGroup>
			{onAddPerson ? (
				<CommandGroup forceMount>
					<CommandItem
						className="h-row gap-2 rounded-ctl px-2 text-body data-[selected=true]:bg-raised"
						forceMount
						onSelect={() => onAddPerson(typed)}
						value="__add-person"
					>
						<span
							aria-hidden="true"
							className="flex size-6 items-center justify-center"
						>
							<PlusIcon />
						</span>
						{typed ? t("addNamed", { name: typed }) : t("add")}
					</CommandItem>
				</CommandGroup>
			) : null}
		</PickerList>
	);
}

"use client";

import { Check, Search, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PersonPicker } from "~/components/pickers/person-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Face } from "~/components/ui/avatar-face";
import { FilterChip } from "~/components/ui/chip";
import { splitKey } from "~/lib/shared-split-input";
import { api } from "~/trpc/react";
import type { EntryPerson } from "../types";

const ref = (p: {
	participantType: string;
	participantId: string;
	name: string;
	avatarUrl?: string | null;
}): EntryPerson => ({
	participantType: p.participantType as EntryPerson["participantType"],
	participantId: p.participantId,
	name: p.name,
	avatarUrl: p.avatarUrl ?? null,
});

/**
 * Who you can split with: a project's members, else your frequent partners,
 * plus everyone you share expenses with for the search. Faces carry identity
 * (R20); people not on Retrospend say so in the picker.
 */
export function usePeople(projectMembers: readonly EntryPerson[] | null) {
	const frequent = api.people.frequentSplitPartners.useQuery(undefined, {
		enabled: projectMembers === null,
	});
	const all = api.people.list.useQuery(undefined, { staleTime: 60_000 });
	return useMemo(() => {
		const known = new Map<string, EntryPerson & { onRetrospend: boolean }>();
		for (const p of all.data ?? []) {
			const id = p.identity;
			known.set(splitKey(id), { ...ref(id), onRetrospend: id.isVerifiedUser });
		}
		const chips = projectMembers ?? (frequent.data ?? []).map(ref);
		for (const p of chips) {
			if (!known.has(splitKey(p)))
				known.set(splitKey(p), {
					...p,
					onRetrospend: p.participantType === "user",
				});
		}
		return { chips, known: [...known.values()] };
	}, [all.data, frequent.data, projectMembers]);
}

/**
 * With: You, Everyone (in a project of three or more), the candidates and
 * whoever is picked, and a search that can add someone not on Retrospend.
 * Each chip shows a face; selected chips are filled.
 */
export function WithField(p: {
	you: { name: string; avatarUrl: string | null };
	youIncluded: boolean;
	others: readonly EntryPerson[];
	chips: readonly EntryPerson[];
	known: readonly (EntryPerson & { onRetrospend: boolean })[];
	inProject: boolean;
	onYou: () => void;
	onToggle: (person: EntryPerson) => void;
	onSet: (people: readonly EntryPerson[]) => void;
}) {
	const t = useTranslations("entry.expense");
	const [open, setOpen] = useState(false);
	const createShadow = api.people.createShadow.useMutation();
	const picked = new Set(p.others.map(splitKey));
	const shown = [
		...p.chips,
		...p.others.filter(
			(o) => !p.chips.some((c) => splitKey(c) === splitKey(o)),
		),
	];
	const allOn =
		p.chips.length > 0 && p.chips.every((c) => picked.has(splitKey(c)));
	const chip = (
		person: EntryPerson,
		on: boolean,
		onClick: () => void,
		label?: string,
	) => (
		<FilterChip
			key={splitKey(person)}
			lead={<Face imageUrl={person.avatarUrl} name={person.name} size="xs" />}
			onClick={onClick}
			selected={on}
		>
			{label ?? person.name.split(" ")[0]}
			{on ? <Check aria-hidden="true" /> : null}
		</FilterChip>
	);
	return (
		<div
			aria-label={t("with")}
			className="flex flex-wrap items-center gap-2"
			role="group"
		>
			{chip(
				{
					participantType: "user",
					participantId: "you",
					name: p.you.name,
					avatarUrl: p.you.avatarUrl,
				},
				p.youIncluded,
				p.onYou,
				t("you"),
			)}
			{p.inProject && p.chips.length >= 2 ? (
				<FilterChip
					lead={<Users aria-hidden="true" />}
					onClick={() => p.onSet(allOn ? [] : p.chips)}
					selected={allOn}
				>
					{t("everyone")}
				</FilterChip>
			) : null}
			{shown.map((o) => chip(o, picked.has(splitKey(o)), () => p.onToggle(o)))}
			<PickerPopover
				onOpenChange={setOpen}
				open={open}
				title={t("searchPeople")}
				trigger={
					<FilterChip lead={<Search aria-hidden="true" />}>
						{t("addPeople")}
					</FilterChip>
				}
			>
				<PersonPicker
					onAddPerson={
						p.inProject
							? undefined
							: async (name) => {
									if (!name) return;
									const made = await createShadow.mutateAsync({ name });
									p.onToggle(ref({ ...made, avatarUrl: null }));
									setOpen(false);
								}
					}
					onChange={(ids) => {
						const next = ids.flatMap((id) => {
							const hit = p.known.find((k) => splitKey(k) === id);
							return hit ? [hit] : [];
						});
						p.onSet(next);
					}}
					people={p.known.map((k) => ({
						id: splitKey(k),
						name: k.name,
						avatarUrl: k.avatarUrl,
						onRetrospend: k.onRetrospend,
					}))}
					value={p.others.map(splitKey)}
				/>
			</PickerPopover>
		</div>
	);
}

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Face } from "~/components/ui/avatar-face";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

/**
 * From (who paid you): the people you share expenses with as chips with
 * their faces (§8), and Someone else for a client or employer typed by name.
 * Past income sources have no read yet (docs/ui/GAPS.md).
 */
export function SourceField({
	value,
	onChange,
}: {
	value: string;
	onChange: (name: string) => void;
}) {
	const t = useTranslations("entry.income");
	const { data } = api.people.frequentSplitPartners.useQuery();
	const people = data ?? [];
	const known = people.some((p) => p.name === value);
	const [other, setOther] = useState(!!value && !known);
	return (
		<div className="flex flex-col gap-2">
			<FilterChips className="max-md:flex-wrap" label={t("from")}>
				{people.map((p) => (
					<FilterChip
						key={`${p.participantType}:${p.participantId}`}
						lead={<Face imageUrl={p.avatarUrl} name={p.name} size="xs" />}
						onClick={() => {
							setOther(false);
							onChange(p.name);
						}}
						selected={!other && value === p.name}
					>
						{p.name}
					</FilterChip>
				))}
				<FilterChip
					onClick={() => {
						setOther(true);
						onChange("");
					}}
					selected={other}
				>
					{t("someoneElse")}
				</FilterChip>
			</FilterChips>
			{other ? (
				<Input
					aria-label={t("sourceAria")}
					autoFocus
					id="income-source"
					onChange={(e) => onChange(e.target.value)}
					placeholder={t("sourcePlaceholder")}
					value={value}
				/>
			) : null}
		</div>
	);
}

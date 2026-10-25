"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Checkbox } from "~/components/ui/checkbox";
import { SkeletonRows } from "~/components/ui/skeleton";
import { categoryTone } from "~/lib/category-tone";
import { api } from "~/trpc/react";
import type { EnvelopeInGroup } from "./use-month";

/** The categories of the user, with the envelope each one lives in today. */
export function useCategoryList(envelopes: readonly EnvelopeInGroup[]) {
	const all = api.categories.getAll.useQuery();
	return useMemo(() => {
		const owner = new Map<string, EnvelopeInGroup>();
		for (const e of envelopes) for (const id of e.categoryIds) owner.set(id, e);
		const list = (all.data ?? []).map((c) => ({
			id: c.id,
			name: c.name,
			icon: c.icon,
			tone: categoryTone(c.color),
			owner: owner.get(c.id) ?? null,
		}));
		return {
			list,
			byId: new Map(list.map((c) => [c.id, c])),
			loading: all.isLoading,
		};
	}, [all.data, all.isLoading, envelopes]);
}

/**
 * The categories an envelope covers, as a list to check. A category lives in
 * one envelope, so one that sits in another says where it comes from and
 * moves here when checked (the preview lists every move).
 */
export function CategoryChecks({
	label,
	value,
	onChange,
	envelopes,
	selfId,
}: {
	label: string;
	value: readonly string[];
	onChange: (ids: string[]) => void;
	envelopes: readonly EnvelopeInGroup[];
	/** The envelope being edited: its own categories carry no "in" line. */
	selfId?: string;
}) {
	const t = useTranslations("budgetSheets.envelopeEdit");
	const cats = useCategoryList(envelopes);
	if (cats.loading) return <SkeletonRows count={3} />;
	if (cats.list.length === 0)
		return <p className="text-fg-3 text-small">{t("noCategories")}</p>;
	const toggle = (id: string) =>
		onChange(
			value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
		);
	return (
		<RowList label={label} variant="flat">
			{cats.list.map((c) => (
				<Row
					key={c.id}
					lead={
						<span className="flex items-center gap-3">
							<Checkbox
								aria-label={c.name}
								checked={value.includes(c.id)}
								onCheckedChange={() => toggle(c.id)}
							/>
							<CategoryGlyph category={c} />
						</span>
					}
					sub={
						c.owner && c.owner.id !== selfId ? (
							<RowSub parts={[t("inEnvelope", { name: c.owner.name })]} />
						) : undefined
					}
					title={c.name}
				/>
			))}
		</RowList>
	);
}

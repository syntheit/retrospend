"use client";

import { useTranslations } from "next-intl";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { ChangeValue, SheetChanges } from "~/components/ui/sheet-changes";

/** The R30 preview as the server returns it (src/server/services/preview/types.ts). */
export type Preview = {
	changes: readonly {
		id: string;
		currency: string;
		before: MoneyValue | null;
		after: MoneyValue | null;
	}[];
	unchanged: readonly { id: string; value: readonly MoneyValue[] }[];
	unavailable: readonly { id: string }[];
};

/**
 * The project sheets' R30 preview on the kit's SheetChanges: each figure
 * that moves, before → after, then the figures checked that stay, then the
 * ones a missing rate kept from being checked. `label` names a figure id.
 */
export function PreviewLines({
	preview,
	label,
	loading,
}: {
	preview: Preview | undefined;
	label: (id: string) => string;
	loading?: boolean;
}) {
	const t = useTranslations("projectV2.preview");
	if (loading || !preview) return <SheetChanges status={t("checking")} />;
	return (
		<SheetChanges
			lines={preview.changes.map((c) => ({
				key: `${c.id}-${c.currency}`,
				label: label(c.id),
				value: (
					<ChangeValue
						from={<Money missing="none" value={c.before} />}
						to={<Money missing="none" value={c.after} />}
					/>
				),
			}))}
			stays={preview.unchanged.map((u) => label(u.id))}
			unavailable={preview.unavailable.map((u) => label(u.id))}
		/>
	);
}

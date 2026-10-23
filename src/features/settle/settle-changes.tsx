"use client";

import { useTranslations } from "next-intl";
import { Balance } from "~/components/money/balance";
import { Money } from "~/components/money/money";
import { ChangeValue, SheetChanges } from "~/components/ui/sheet-changes";
import type { PersonIdentityDTO } from "~/features/people/types";
import type { SettleState } from "./use-settle";

type Preview = NonNullable<SettleState["preview"]>;
type Change = Preview["changes"][number];

const zero = (currency: string) => ({ minor: 0, currency });

/** What this changes, and what was checked and does not change (R30). */
export function Changes({
	preview,
	person,
	done,
}: {
	preview: Pick<Preview, "changes" | "unchanged" | "unavailable">;
	person: PersonIdentityDTO;
	done?: boolean;
}) {
	const t = useTranslations("settleSheet.changes");
	const name = (id: string) =>
		id === "owed.owedToYou"
			? t("owedToYou")
			: id === "owed.youOwe"
				? t("youOwe")
				: t("yourBalance", { name: person.name });
	const label = (c: Change) =>
		c.id === "balance.person"
			? t("balance", { name: person.name, currency: c.currency })
			: name(c.id);
	const show = (c: Change, m: { minor: number; currency: string }) =>
		c.id === "balance.person" ? <Balance amount={m} /> : <Money value={m} />;
	return (
		<SheetChanges
			done={done}
			lines={preview.changes.map((c) => ({
				key: `${c.id}-${c.currency}`,
				label: label(c),
				value: (
					<ChangeValue
						from={show(c, c.before ?? zero(c.currency))}
						to={show(c, c.after ?? zero(c.currency))}
					/>
				),
			}))}
			stays={preview.unchanged.map((u) => name(u.id))}
			unavailable={preview.unavailable.map((u) => name(u.id))}
		/>
	);
}

"use client";

import { Money } from "~/components/money/money";
import { AccountMark } from "~/components/rows/account-mark";
import { FilterChips } from "~/components/ui/chip";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { GlyphPill } from "~/components/ui/glyph-pill";
import type { EntryCatalog } from "./shared-ui";

type Place = EntryCatalog["places"][number];

/**
 * Accounts as wrapping pills for a composer panel: the account's mark (or its
 * currency's flag), its name and its balance. `none` adds the no-account
 * choice first (the move then touches no account).
 */
export function AccountPills({
	places,
	value,
	onChange,
	label,
	none,
}: {
	places: readonly Place[];
	value: string | null;
	onChange: (id: string | null) => void;
	label: string;
	none?: string;
}) {
	return (
		<FilterChips className="max-md:flex-wrap max-md:overflow-x-visible" label={label}>
			{none ? (
				<GlyphPill onClick={() => onChange(null)} selected={value === null}>
					{none}
				</GlyphPill>
			) : null}
			{places.map((p) => (
				<GlyphPill
					key={p.id}
					lead={
						p.icon ? (
							<AccountMark icon={p.icon} name={p.name} size="menu" />
						) : (
							<CurrencyFlag className="size-4" currencyCode={p.currency} />
						)
					}
					onClick={() => onChange(p.id)}
					selected={value === p.id}
				>
					<span className="truncate">{p.name}</span>
					<span className="text-fg-3 text-meta">
						<Money value={p.balance} />
					</span>
				</GlyphPill>
			))}
		</FilterChips>
	);
}

"use client";

import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { CurrencyTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { useCurrencyName } from "./currency-detail";
import { useCurrencySub } from "./currency-name";
import { StarButton } from "./star-button";
import type { CurrencyRow } from "./types";
import { targetOf } from "./use-currency-actions";

/** Phone: one row per currency, the default price with its type under it. */
export function RatesList({
	rows,
	handlers,
	onSelect,
	onFavorite,
}: {
	rows: CurrencyRow[];
	handlers: ActionHandlers<CurrencyTarget>;
	onSelect: (code: string) => void;
	onFavorite: (row: CurrencyRow, on: boolean) => void;
}) {
	const t = useTranslations("currenciesPage");
	const label = useRateLabel();
	const sub = useCurrencySub();
	const name = useCurrencyName();
	return (
		<RowList label={t("title")}>
			{rows.map((row) => {
				const price = row.defaultType ? row.prices[row.defaultType] : undefined;
				return (
					<ActionArea
						entity="currency"
						handlers={handlers}
						key={row.code}
						target={targetOf(row)}
					>
						<Row
							actions={
								<ActionMenu
									entity="currency"
									handlers={handlers}
									target={targetOf(row)}
								/>
							}
							end={
								price && row.defaultType ? (
									<>
										<Money value={price} />
										<span className="text-fg-3 text-meta">
											{label(row.defaultType)}
										</span>
									</>
								) : (
									<span className="text-attention-text">{t("noRate")}</span>
								)
							}
							lead={
								<StarButton onToggle={(on) => onFavorite(row, on)} row={row} />
							}
							open={{ onOpen: () => onSelect(row.code), label: row.code }}
							sub={
								<RowSub
									parts={[row.types.length ? name(row.code) : sub(row)]}
								/>
							}
							title={row.code}
						/>
					</ActionArea>
				);
			})}
		</RowList>
	);
}

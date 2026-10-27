"use client";

import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { CurrencyTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { cn } from "~/lib/cn";
import { CurrencyName } from "./currency-name";
import { RateText } from "./rate-text";
import { StarButton } from "./star-button";
import { type CurrencyRow, MARKET } from "./types";
import { targetOf } from "./use-currency-actions";

/** Where a currency with no rate says so: official for fiat, market for coins. */
const missingColumn = (row: CurrencyRow, columns: string[]) =>
	row.crypto ? MARKET : (columns.find((c) => c !== MARKET) ?? MARKET);

function RateCell({
	row,
	type,
	columns,
	base,
}: {
	row: CurrencyRow;
	type: string;
	columns: string[];
	/** The one unit every price shares, when there is one. */
	base: string | null;
}) {
	const t = useTranslations("currenciesPage");
	const price = row.prices[type];
	if (!row.types.length && type === missingColumn(row, columns))
		return <span className="text-attention-text">{t("noRate")}</span>;
	if (!price)
		return (
			<span className="text-fg-3">
				<span aria-hidden="true">-</span>
				<span className="sr-only">{t("noType")}</span>
			</span>
		);
	return (
		<RateText
			className={cn(type === row.defaultType && "font-semibold")}
			price={price}
			showBase={!base}
		/>
	);
}

/**
 * Desktop: one table, a column per rate type, each cell the stronger currency of the pair
 * priced in the weaker,
 * the default type in bold. A row click selects the currency for the
 * detail panel; right-click and ⋯ open the registry menu.
 */
export function RatesTable({
	rows,
	columns,
	base,
	selected,
	handlers,
	onSelect,
	onFavorite,
	favoriteBusy,
}: {
	rows: CurrencyRow[];
	columns: string[];
	base: string | null;
	selected: string | null;
	handlers: ActionHandlers<CurrencyTarget>;
	onSelect: (code: string) => void;
	onFavorite: (row: CurrencyRow, on: boolean) => void;
	favoriteBusy: boolean;
}) {
	const t = useTranslations("currenciesPage");
	const label = useRateLabel();
	return (
		<div>
			<Table look="panel">
				<TableHeader>
					<TableRow>
						<TableHead className="w-12">
							<span className="sr-only">{t("favorite")}</span>
						</TableHead>
						<TableHead>{t("currency")}</TableHead>
						{columns.map((c) => (
							<TableHead className="text-right" key={c}>
								{label(c)}
							</TableHead>
						))}
						<TableHead className="w-12">
							<span className="sr-only">{t("actions")}</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<ActionArea
							entity="currency"
							handlers={handlers}
							key={row.code}
							target={targetOf(row)}
						>
							<TableRow
								aria-current={row.code === selected ? "true" : undefined}
								className="cursor-pointer"
								data-state={row.code === selected ? "selected" : undefined}
								onClick={() => onSelect(row.code)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && e.target === e.currentTarget)
										onSelect(row.code);
								}}
								tabIndex={0}
							>
								<TableCell>
									<StarButton
										busy={favoriteBusy}
										onToggle={(on) => onFavorite(row, on)}
										row={row}
									/>
								</TableCell>
								<TableCell className="max-w-52">
									<CurrencyName row={row} />
								</TableCell>
								{columns.map((c) => (
									<TableCell className="text-right tabular-nums" key={c}>
										<RateCell
											base={base}
											columns={columns}
											row={row}
											type={c}
										/>
									</TableCell>
								))}
								<TableCell onClick={(e) => e.stopPropagation()}>
									<ActionMenu
										entity="currency"
										handlers={handlers}
										target={targetOf(row)}
									/>
								</TableCell>
							</TableRow>
						</ActionArea>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

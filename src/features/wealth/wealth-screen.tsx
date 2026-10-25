"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { Toolbar } from "~/components/layout/toolbar";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/cn";
import { type AccountFilters, AccountList, NO_FILTERS } from "./account-list";
import { Breakdown } from "./breakdown";
import { NetWorthHero } from "./net-worth-hero";
import { AccountSheet } from "./sheets/account-sheet";
import { CloseAccountSheet } from "./sheets/close-account-sheet";
import { UpdateBalanceSheet } from "./sheets/update-balance-sheet";
import type { WealthView } from "./types";
import { type SheetState, useAccountActions } from "./use-account-actions";
import { WealthHeader } from "./wealth-header";

/** Hide amounts: every Money on the page becomes a raised bar of its width. */
const MASK =
	"[&_[data-slot=money]]:select-none [&_[data-slot=money]]:rounded-chip [&_[data-slot=money]]:bg-raised [&_[data-slot=money]]:text-transparent";

/** The Wealth page: header, hero, one toolbar, the accounts or the breakdown. */
export function WealthScreen({ view }: { view: WealthView }) {
	const t = useTranslations("wealthPage");
	const [hidden, setHidden] = useState(view.hideAmounts);
	const [mode, setMode] = useState<"accounts" | "breakdown">("accounts");
	const [filters, setFilters] = useState<AccountFilters>(NO_FILTERS);
	const [sheet, setSheet] = useState<SheetState>(null);
	const actions = useAccountActions(view, setSheet);
	const closeSheet = (open: boolean) => {
		if (!open) setSheet(null);
	};
	const set = (patch: Partial<AccountFilters>) =>
		setFilters((f) => ({ ...f, ...patch }));
	const accounts = mode === "accounts";

	return (
		<PageFrame label="wealth">
			<div className={cn(hidden && MASK)}>
				<WealthHeader
					hidden={hidden}
					onAdd={() => setSheet({ kind: "add" })}
					onToggleHidden={() => setHidden((h) => !h)}
					view={view}
				/>
				<NetWorthHero view={view} />
				<Toolbar
					className="mt-8"
					end={
						<Segmented
							label={t("view")}
							onChange={setMode}
							options={[
								{ value: "accounts", label: t("accounts") },
								{ value: "breakdown", label: t("breakdown.title") },
							]}
							value={mode}
						/>
					}
					label={t("filters.label")}
					search={
						accounts ? (
							<Input
								aria-label={t("filters.search")}
								className="h-ctl w-60 max-md:w-full"
								onChange={(e) => set({ query: e.target.value })}
								placeholder={t("filters.search")}
								type="search"
								value={filters.query}
							/>
						) : undefined
					}
				>
					{accounts ? (
						<FilterChips label={t("filters.label")}>
							<FilterChip
								onClick={() =>
									set({ liquid: filters.liquid === "liquid" ? null : "liquid" })
								}
								selected={filters.liquid === "liquid"}
							>
								{t("filters.liquid")}
							</FilterChip>
							<FilterChip
								onClick={() =>
									set({
										liquid: filters.liquid === "illiquid" ? null : "illiquid",
									})
								}
								selected={filters.liquid === "illiquid"}
							>
								{t("filters.illiquid")}
							</FilterChip>
							<FilterChip
								onClick={() => set({ foreign: !filters.foreign })}
								selected={filters.foreign}
							>
								{t("filters.foreign")}
							</FilterChip>
						</FilterChips>
					) : null}
				</Toolbar>
				{accounts ? (
					<AccountList
						filters={filters}
						handlers={actions.handlers}
						onAdd={() => setSheet({ kind: "add" })}
						onClear={() => setFilters(NO_FILTERS)}
						onOpen={(a) => setSheet({ kind: "update", account: a })}
						view={view}
					/>
				) : (
					<Breakdown view={view} />
				)}
			</div>
			{sheet?.kind === "update" ? (
				<UpdateBalanceSheet
					account={sheet.account}
					onOpenChange={closeSheet}
					onSave={(value, type) =>
						actions.updateBalance(sheet.account, value, type)
					}
				/>
			) : null}
			{sheet?.kind === "add" || sheet?.kind === "edit" ? (
				<AccountSheet
					account={sheet.kind === "edit" ? sheet.account : null}
					home={view.home}
					onOpenChange={closeSheet}
					onSave={(d) =>
						actions.saveAccount(sheet.kind === "edit" ? sheet.account : null, d)
					}
					rateTypes={view.rateTypes}
				/>
			) : null}
			{sheet?.kind === "close" ? (
				<CloseAccountSheet
					account={sheet.account}
					onClose={() => actions.closeAccount(sheet.account)}
					onOpenChange={closeSheet}
				/>
			) : null}
		</PageFrame>
	);
}

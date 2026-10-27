"use client";

import { SearchX, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { useEffect, useRef, useState } from "react";
import { BackButton, PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Toolbar } from "~/components/layout/toolbar";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { useIsMobile } from "~/hooks/use-mobile";
import { CurrencyDetail, useCurrencyName } from "./currency-detail";
import { QuickConvert, readConvQuery } from "./quick-convert";
import { RatesList } from "./rates-list";
import { RatesTable } from "./rates-table";
import type { CurrenciesView } from "./types";
import { useCurrencyActions } from "./use-currency-actions";

type Kind = "fiat" | "crypto" | null;

const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();

/** "/" focuses the search, unless the person is typing somewhere. */
function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = document.activeElement;
			const typing =
				el instanceof HTMLInputElement ||
				el instanceof HTMLTextAreaElement ||
				(el instanceof HTMLElement && el.isContentEditable);
			if (e.key !== "/" || typing || e.metaKey || e.ctrlKey) return;
			e.preventDefault();
			ref.current?.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [ref]);
}

/** The Currencies page: one table of every rate type, a detail panel with the converter. */
export function CurrenciesScreen({
	view,
	initial,
}: {
	view: CurrenciesView;
	/** ?cur=XXX: the currency to select (the palette opens the page this way). */
	initial: string | null;
}) {
	const t = useTranslations("currenciesPage");
	const nav = useTranslations("shell.nav");
	const locale = useMoneyLocale();
	const phone = useIsMobile();
	const name = useCurrencyName();
	const label = useRateLabel();
	const { short } = useRowDates();
	const search = useRef<HTMLInputElement>(null);
	useSlashFocus(search);
	const firstPriced = view.rows.find((r) => r.types.length)?.code ?? null;
	const [selected, setSelected] = useState<string | null>(
		initial && view.rows.some((r) => r.code === initial)
			? initial
			: firstPriced,
	);
	const [sheetOpen, setSheetOpen] = useState(false);
	// A currency in the link opens its sheet on a phone, once the width is known.
	const opened = useRef(false);
	useEffect(() => {
		if (!phone || opened.current || !initial) return;
		opened.current = true;
		setSheetOpen(true);
	}, [phone, initial]);
	const [query, setQuery] = useState("");
	const [favorites, setFavorites] = useState(false);
	const [kind, setKind] = useState<Kind>(null);
	const select = (code: string) => {
		setSelected(code);
		if (phone) setSheetOpen(true);
	};
	const { handlers, setFavorite, favoriteBusy } = useCurrencyActions(
		view,
		select,
	);
	const conv = readConvQuery(query, view.home, view.rows, locale);

	const rows = view.rows.filter((r) => {
		if (favorites && !r.favorite) return false;
		if (kind && (kind === "crypto") !== r.crypto) return false;
		if (conv) return r.code === conv.code;
		const q = fold(query.trim());
		return !q || fold(`${r.code} ${name(r.code)}`).includes(q);
	});
	const row = view.rows.find((r) => r.code === selected) ?? null;
	const missing = view.rows.filter((r) => !r.types.length && r.usedBy.length);
	const sub = [
		view.base ? t("pricesIn", { base: view.base }) : null,
		view.updated ? t("updated", { date: short(view.updated) }) : null,
		view.homeDefault ? t("newUse", { type: label(view.homeDefault) }) : null,
	]
		.filter(Boolean)
		.join(" ");

	const list = !rows.length ? (
		<Empty
			action={
				<Button
					kind="secondary"
					onClick={() => {
						setQuery("");
						setFavorites(false);
						setKind(null);
					}}
					size="sm"
				>
					{favorites ? t("empty.showAll") : t("empty.clear")}
				</Button>
			}
			hint={favorites ? t("empty.noFavoritesHint") : t("empty.noneHint")}
			icon={favorites ? Star : SearchX}
			title={favorites ? t("empty.noFavorites") : t("empty.none")}
		/>
	) : phone ? (
		<RatesList
			base={view.base}
			favoriteBusy={favoriteBusy}
			handlers={handlers}
			onFavorite={setFavorite}
			onSelect={select}
			rows={rows}
		/>
	) : (
		<RatesTable
			base={view.base}
			columns={view.columns}
			favoriteBusy={favoriteBusy}
			handlers={handlers}
			onFavorite={setFavorite}
			onSelect={select}
			rows={rows}
			selected={selected}
		/>
	);
	const detail = row ? (
		<CurrencyDetail
			favoriteBusy={favoriteBusy}
			onFavorite={(on) => setFavorite(row, on)}
			row={row}
			view={view}
		/>
	) : null;

	return (
		<PageFrame label="currencies">
			<PageHeader
				lead={<BackButton href="/wealth" label={nav("wealth")} />}
				sub={sub || undefined}
				title={t("title")}
			/>
			<Toolbar
				label={t("filters.label")}
				search={
					<Input
						aria-label={t("filters.search")}
						className="h-ctl w-60 max-md:w-full"
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("filters.search")}
						ref={search}
						type="search"
						value={query}
					/>
				}
			>
				<FilterChips label={t("filters.label")}>
					<FilterChip
						onClick={() => setFavorites((f) => !f)}
						selected={favorites}
					>
						{t("filters.favorites")}
					</FilterChip>
					<FilterChip
						onClick={() => setKind((k) => (k === "fiat" ? null : "fiat"))}
						selected={kind === "fiat"}
					>
						{t("filters.fiat")}
					</FilterChip>
					<FilterChip
						onClick={() => setKind((k) => (k === "crypto" ? null : "crypto"))}
						selected={kind === "crypto"}
					>
						{t("filters.crypto")}
					</FilterChip>
				</FilterChips>
			</Toolbar>
			{conv ? <QuickConvert query={conv} /> : null}
			{missing.length ? (
				<Notice className="mb-4" tone="attention">
					{t("missing", {
						codes: missing.map((m) => m.code).join(", "),
						names: missing.flatMap((m) => m.usedBy).join(", "),
						count: missing.flatMap((m) => m.usedBy).length,
					})}
				</Notice>
			) : null}
			{phone ? (
				list
			) : (
				<div className="flex items-start gap-8">
					<div className="min-w-0 flex-1">{list}</div>
					<aside
						aria-label={t("detail.label")}
						className="sticky top-0 w-90 shrink-0"
					>
						{detail}
					</aside>
				</div>
			)}
			{phone && row ? (
				<Sheet
					detent="large"
					footer={false}
					onOpenChange={setSheetOpen}
					open={sheetOpen}
					title={t("detail.sheetTitle", { code: row.code })}
				>
					{detail}
				</Sheet>
			) : null}
		</PageFrame>
	);
}

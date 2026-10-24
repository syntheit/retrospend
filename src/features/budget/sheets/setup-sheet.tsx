"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Field } from "~/features/entry/shared-ui";
import { api } from "~/trpc/react";
import { AmountCell } from "./amount-cell";
import { FigureChanges } from "./figure-changes";
import type { SheetProps } from "./types";
import { useMoneyWrite } from "./use-money-write";
import { useMonth } from "./use-month";
import { type SetupStyle, useSetup } from "./use-setup";

const STYLES: SetupStyle[] = [
	"FLEX",
	"EVERY_DOLLAR",
	"SAVE_FIRST",
	"LIMITS",
	"FIFTY_THIRTY_TWENTY",
	"WEEKLY",
];

/**
 * Set up your budget (the first run): pick how you like to budget, say how
 * much you have now, keep or drop the proposed envelopes and change their
 * amounts. The server previews exactly what is created and Save writes it.
 * Limits asks no money now: its limits fund themselves.
 */
function SetupForm({ open, onClose }: SheetProps) {
	const t = useTranslations("budgetSheets.setup");
	const ts = useTranslations("budgetSheets.style");
	const locale = useLocale();
	const tp = useTranslations("budgetSheets.pool");
	const s = useSetup(locale);
	const preview = api.envelope.setupPreview.useMutation();
	const commit = api.envelope.setup.useMutation();
	const w = useMoneyWrite({
		input: s.input,
		preview: preview.mutateAsync,
		commit: async (input) => {
			// The proposal is refused once the budget exists: stop reading it first.
			s.setDone(true);
			try {
				return await commit.mutateAsync(input);
			} catch (error) {
				s.setDone(false);
				throw error;
			}
		},
		toast: () => t("toast"),
	});
	const p = s.preset;
	const groups = (p?.groups ?? []).map((g) => ({
		g,
		envelopes: (p?.envelopes ?? []).filter((e) => e.groupKey === g.key),
	}));
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={w.submit}
			open={open}
			submitDisabled={!w.ready}
			submitLabel={t("start")}
			title={t("title")}
			wide
		>
			<div className="flex flex-col gap-4 pb-4">
				<p className="text-fg-2 text-small">{t("lead")}</p>
				<Field label={t("style")}>
					<Select
						kit
						onValueChange={(v) => s.setStyle(v as SetupStyle)}
						value={s.style}
					>
						<SelectTrigger aria-label={t("style")} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{STYLES.map((x) => (
								<SelectItem key={x} value={x}>
									{ts(`${x}.name`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<p className="text-fg-3 text-small">{ts(`${s.style}.sub`)}</p>
				{!p || s.loading ? (
					<SkeletonRows count={4} />
				) : (
					<>
						{s.style === "LIMITS" ? null : (
							<Field label={t("haveNow")}>
								<MoneyInput
									currency={p.currency}
									onChange={(text) => s.money.set(text)}
									value={s.money.text}
								/>
							</Field>
						)}
						{groups.map(({ g, envelopes }) => (
							<section aria-label={s.name(g.nameKey, null)} key={g.key}>
								<h3 className="text-fg text-small mb-1 font-semibold">
									{s.name(g.nameKey, null)}
								</h3>
								<RowList variant="flat">
									{envelopes.map((e) => (
										<Row
											end={
												e.target && e.target.kind !== "BILL_TEMPLATE" ? (
													<AmountCell
														currency={p.currency}
														label={t("amountFor", {
															name: s.name(e.nameKey, e.name),
														})}
														onChange={(text) => s.setText(e.key, text)}
														value={s.texts[e.key] ?? ""}
													/>
												) : null
											}
											key={e.key}
											lead={
												<Checkbox
													aria-label={t("keep", {
														name: s.name(e.nameKey, e.name),
													})}
													checked={e.isDefault || !s.off.has(e.key)}
													disabled={e.isDefault}
													onCheckedChange={() => s.toggle(e.key)}
												/>
											}
											sub={
												e.target?.kind === "BILL_TEMPLATE" ? (
													<RowSub parts={[t("followsRecurring")]} />
												) : undefined
											}
											title={s.name(e.nameKey, e.name)}
										/>
									))}
								</RowList>
							</section>
						))}
						<FigureChanges
							dry={w.dry}
							own={() =>
								s.money.minor
									? [
											{
												key: "start",
												label: t("moneyNow"),
												value: (
													<Money
														value={{
															minor: s.money.minor,
															currency: p.currency,
														}}
													/>
												),
											},
										]
									: []
							}
							poolName={tp(
								s.style === "EVERY_DOLLAR" ? "toAssign" : "notPlannedYet",
							)}
						/>
					</>
				)}
			</div>
		</Sheet>
	);
}

/**
 * Set up your budget only when there is none: setup refuses a second book,
 * so with one the sheet says so instead of offering a form that cannot save.
 */
export function SetupSheet(props: SheetProps) {
	const t = useTranslations("budgetSheets.setup");
	const book = useMonth(props.month);
	// Read once: the budget this sheet creates must not turn it into the message.
	const had = useRef<boolean | null>(null);
	if (had.current === null && !book.loading) had.current = book.data !== null;
	if (had.current)
		return (
			<Sheet
				cancelLabel={t("ok")}
				detent="medium"
				onOpenChange={(o) => !o && props.onClose()}
				open={props.open}
				title={t("title")}
			>
				<p className="text-fg-2 text-small">{t("exists")}</p>
			</Sheet>
		);
	return <SetupForm {...props} />;
}

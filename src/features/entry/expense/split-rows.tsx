"use client";

import { formatPercent } from "@retrospend/domain/format-percent";
import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { Minus, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tip } from "~/components/ui/tooltip";
import { type SplitRef, splitKey } from "~/lib/shared-split-input";
import type { EntryPerson } from "../types";
import { amountLeft, type ExpenseDraft, pctLeft } from "./draft";

type Draft = ReturnType<typeof import("./use-expense-draft").useExpenseDraft>;

/** The custom split's header: what is left (amount or percent), or the share count. */
export function CustomHead({ d, you }: { d: ExpenseDraft; you: EntryPerson }) {
	const t = useTranslations("entry.expense");
	const locale = useLocale();
	if (d.by === "shares") {
		const units = [...(d.youIncluded ? [you] : []), ...d.others].reduce(
			(n, m) => n + (d.shares[splitKey(m)] ?? 1),
			0,
		);
		return (
			<span className="text-fg-2 text-small">
				{t("sharesCount", { count: units })}
			</span>
		);
	}
	if (d.by === "pct") {
		const left = pctLeft(d, you);
		const pct = formatPercent(Math.round(Math.abs(left) * 100), {
			locale,
			digits: 2,
		});
		return (
			<span
				className={
					Math.abs(left) < 0.01
						? "text-positive text-small"
						: "text-attention-text text-small"
				}
			>
				{Math.abs(left) < 0.01
					? t("pctDone")
					: left > 0
						? t("pctLeft", { pct })
						: t("pctOver", { pct })}
			</span>
		);
	}
	const left = amountLeft(d, you);
	const money = { minor: Math.abs(left), currency: d.currency };
	return (
		<span
			className={
				left === 0
					? "text-positive text-small"
					: "text-attention-text text-small"
			}
		>
			{left >= 0
				? t.rich("left", { amount: () => <Money value={money} /> })
				: t.rich("over", { amount: () => <Money value={money} /> })}
		</span>
	);
}

export function SplitRow(p: {
	d: ExpenseDraft;
	x: Draft;
	person: EntryPerson;
	you: EntryPerson;
	share: number | null;
	nameOf: (r: SplitRef) => string;
}) {
	const t = useTranslations("entry.expense");
	const locale = useLocale();
	const { d, person } = p;
	const key = splitKey(person);
	const name = p.nameOf(person);
	const paid = splitKey(d.paidBy) === key;
	const value =
		p.share !== null ? { minor: p.share, currency: d.currency } : null;
	let end: React.ReactNode = value ? (
		<Money className="text-fg" value={value} />
	) : null;
	if (d.split === "custom" && d.by === "amount") {
		const minor = d.exact[key];
		end = (
			<Input
				aria-label={t("amountFor", { name })}
				className="w-32 text-right tabular-nums"
				defaultValue={
					minor != null ? draftFromMinor(minor, locale, d.currency) : ""
				}
				inputMode="decimal"
				onChange={(e) => {
					const r = parseMoneyInput(e.target.value, locale, d.currency);
					p.x.setExact(key, r.ok ? r.minor : null);
				}}
				placeholder="0"
			/>
		);
	} else if (d.split === "custom" && d.by === "pct") {
		end = (
			<span className="flex items-center gap-2">
				{value ? <Money className="text-fg-3" value={value} /> : null}
				<Input
					aria-label={t("percentFor", { name })}
					className="w-20 text-right tabular-nums"
					defaultValue={String(d.pct[key] ?? "")}
					inputMode="decimal"
					onChange={(e) =>
						p.x.setPct(key, Number(e.target.value.replace(",", ".")) || 0)
					}
				/>
			</span>
		);
	} else if (d.split === "custom" && d.by === "shares") {
		end = (
			<span className="flex items-center gap-2">
				{value ? <Money className="text-fg-3" value={value} /> : null}
				<Tip content={t("fewerShares", { name })}>
					<Button
						aria-label={t("fewerShares", { name })}
						icon
						kind="ghost"
						onClick={() => p.x.stepShares(key, -1)}
						size="sm"
					>
						<Minus />
					</Button>
				</Tip>
				<span className="w-6 text-center tabular-nums">
					{d.shares[key] ?? 1}
				</span>
				<Tip content={t("moreShares", { name })}>
					<Button
						aria-label={t("moreShares", { name })}
						icon
						kind="ghost"
						onClick={() => p.x.stepShares(key, 1)}
						size="sm"
					>
						<Plus />
					</Button>
				</Tip>
			</span>
		);
	}
	return (
		<li
			className="border-line flex min-h-11 items-center gap-3 border-b"
			data-split-row={key}
		>
			<Face imageUrl={person.avatarUrl} name={person.name} size="sm" />
			<span className="text-body min-w-0 flex-1 truncate">
				{name}
				{paid ? (
					<span className="text-fg-3 text-meta block">{t("rowPaid")}</span>
				) : null}
			</span>
			{end}
		</li>
	);
}

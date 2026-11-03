"use client";

import { categoryTone } from "@retrospend/domain/category-tone";
import { toMinorUnits } from "@retrospend/domain/money";
import { dayKey } from "@retrospend/domain/time-zone";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";
import { Money } from "~/components/money/money";
import { useRateFormat } from "~/components/money/use-rate-format";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Face, type FacePerson, FaceStack } from "~/components/ui/avatar-face";
import type { RouterOutputs } from "~/trpc/react";
import { Row, type Tx } from "../read/read-view";

type Personal = RouterOutputs["entry"]["expense"]["get"];
type Cat = { name: string; icon?: string | null; color: string } | null;

/** The title with its bare category glyph: the pane header. */
export function PaneTitle({
	title,
	category,
}: {
	title: string;
	category: Cat;
}) {
	return (
		<span className="inline-flex min-w-0 items-center gap-2">
			{category ? (
				<CategoryGlyph
					category={{
						id: "",
						name: category.name,
						icon: category.icon,
						tone: categoryTone(category.color),
					}}
				/>
			) : null}
			<span className="truncate">{title}</span>
		</span>
	);
}

/**
 * The one hero figure: the amount as entered. A foreign amount has the home
 * value under it and the rate line (type and number, never below 1).
 */
function Hero({
	figure,
	amount,
	home,
	rate,
}: {
	figure: string;
	amount: { minor: number; currency: string };
	home?: ReactNode;
	rate?: string | null;
}) {
	return (
		<div className="border-line flex flex-col gap-1 border-b pb-4">
			<Money className="text-hero text-fg" figure={figure} value={amount} />
			{home}
			{rate ? <span className="text-fg-3 text-small">{rate}</span> : null}
		</div>
	);
}

type Row = RouterOutputs["expense"]["rowV2"];

/** The rate line of a row: its type with its number, only when booked at a named type. */
function useRateLine(row: Row | null | undefined) {
	const types = useTranslations("activity.rateTypes");
	const rates = useRateFormat();
	if (!row?.rateType || !row.rate || !row.home) return null;
	const name = types.has(row.rateType) ? types(row.rateType) : row.rateType;
	return rates.typed(name, row.amount.currency, row.home.currency, row.rate);
}

/** The home value of a foreign amount: a number, or the words for no rate yet. */
function HomeLine({ row }: { row: Row | null | undefined }) {
	if (!row || row.home === undefined) return null;
	return row.home ? (
		<Money className="text-fg-2 text-body" value={row.home} />
	) : (
		<Money className="text-fg-2 text-body" missing="noRate" value={null} />
	);
}

/** Facts of one of your own expenses (what the server sent, formatted). */
export function PersonalFacts({
	e,
	row,
}: {
	e: Personal;
	row: Row | null | undefined;
}) {
	const t = useTranslations("entry.detail");
	const tr = useTranslations("entry.read");
	const { label } = useDateFormat();
	const rate = useRateLine(row);
	return (
		<div className="flex flex-col gap-1" data-entry-read="">
			<Hero
				amount={{
					minor: toMinorUnits(e.amount, e.currency),
					currency: e.currency,
				}}
				figure={`entry.amount:personal:${e.id}`}
				home={<HomeLine row={row} />}
				rate={rate}
			/>
			<Row k={tr("date")}>{label.long(dayKey(new Date(e.date)))}</Row>
			{e.category ? <Row k={tr("category")}>{e.category.name}</Row> : null}
			{e.isAmortizedParent && e.children?.length ? (
				<Row k={t("spread")}>{t("months", { count: e.children.length })}</Row>
			) : null}
			{e.recurringTemplateId ? (
				<Row k={t("recurring")}>
					<Link className="text-brand" href="/activity/recurring">
						{t("recurringOpen")}
					</Link>
				</Row>
			) : null}
			{e.location ? <Row k={t("location")}>{e.location}</Row> : null}
			{e.excludeFromAnalytics ? <Row k={t("hidden")}>{t("yes")}</Row> : null}
			{e.description ? <Row k={t("note")}>{e.description}</Row> : null}
		</div>
	);
}

/** Facts of a shared expense: payer, the split with faces, your share, status. */
export function SharedFacts({
	tx,
	me,
	row,
}: {
	tx: Tx;
	me: string | undefined;
	row: Row | null | undefined;
}) {
	const t = useTranslations("entry.detail");
	const tr = useTranslations("entry.read");
	const { label } = useDateFormat();
	const money = (n: number) => ({
		minor: toMinorUnits(n, tx.currency),
		currency: tx.currency,
	});
	const mine = tx.splitParticipants.find(
		(p) => p.participantType === "user" && p.participantId === me,
	);
	const people = useMemo<FacePerson[]>(
		() =>
			tx.splitParticipants.map((p) => ({
				id: `${p.participantType}:${p.participantId}`,
				name: p.name,
				imageUrl: p.avatarUrl,
				isSelf: p.participantType === "user" && p.participantId === me,
				share: money(p.shareAmount),
			})),
		// biome-ignore lint/correctness/useExhaustiveDependencies: money is a pure helper of tx
		[tx, me, money],
	);
	const rate = useRateLine(row);
	const payer = `${tx.paidBy.participantType}:${tx.paidBy.participantId}`;
	return (
		<div className="flex flex-col gap-1" data-entry-read="">
			<Hero
				amount={money(tx.amount)}
				figure={`entry.amount:shared:${tx.id}`}
				home={<HomeLine row={row} />}
				rate={rate}
			/>
			<Row k={tr("paidBy")}>
				<Face imageUrl={tx.paidBy.avatarUrl} name={tx.paidBy.name} size="xs" />
				{tx.paidBy.name}
			</Row>
			{people.length > 1 ? (
				<Row k={t("splitWith")}>
					<FaceStack payerId={payer} people={people} />
				</Row>
			) : null}
			{mine && people.length > 1 ? (
				<Row k={tr("yourShare")}>
					<Money
						figure={`entry.share:shared:${tx.id}`}
						value={money(mine.shareAmount)}
					/>
				</Row>
			) : null}
			<Row k={tr("date")}>{label.long(dayKey(new Date(tx.date)))}</Row>
			{tx.category ? <Row k={tr("category")}>{tx.category.name}</Row> : null}
			{tx.projectName ? <Row k={tr("project")}>{tx.projectName}</Row> : null}
			{mine ? (
				<Row k={tr("state")}>{tr(`states.${mine.verificationStatus}`)}</Row>
			) : null}
			{tx.notes ? <Row k={t("note")}>{tx.notes}</Row> : null}
		</div>
	);
}

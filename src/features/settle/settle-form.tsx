"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useRowDates } from "~/components/rows/dates";
import { Face } from "~/components/ui/avatar-face";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { useMethodName } from "~/features/people/method-name";
import type { PersonIdentityDTO } from "~/features/people/types";
import type { SettleState } from "./use-settle";

/** Generic methods offered besides the ones you share with them. */
const GENERIC = ["bank_transfer", "cash"];

/** Who pays whom: both faces, an arrow, and the direction switch. */
type FaceRef = { name: string; imageUrl: string | null };

function Head({
	s,
	person,
	face,
	me,
}: {
	s: SettleState;
	person: PersonIdentityDTO;
	/** The person's face: the full name keeps its color and initials. */
	face: FaceRef;
	me: FaceRef;
}) {
	const t = useTranslations("settleSheet");
	const c = s.ctx;
	if (!c) return null;
	const them = <Face imageUrl={face.imageUrl} name={face.name} size="md" />;
	const you = <Face imageUrl={me.imageUrl} name={me.name} size="md" />;
	const incoming = c.direction === "incoming";
	return (
		<div className="flex flex-wrap items-center gap-3">
			<span className="flex items-center gap-2">
				{incoming ? them : you}
				<ArrowRight aria-hidden="true" className="text-fg-3 size-4" />
				{incoming ? you : them}
			</span>
			<Segmented
				label={t("direction")}
				onChange={s.setDirection}
				options={[
					{ value: "outgoing", label: t("iPaid", { name: person.name }) },
					{ value: "incoming", label: t("theyPaid", { name: person.name }) },
				]}
				value={c.direction}
			/>
		</div>
	);
}

/** Amount (R22: normal input height), then the explicit fills. */
function Amount({ s }: { s: SettleState }) {
	const t = useTranslations("settleSheet");
	const c = s.ctx;
	if (!c) return null;
	const all = c.everything;
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="settle-amount">{t("amount")}</Label>
			<MoneyInput
				currency={c.currency}
				favoriteCurrencies={c.currencies}
				id="settle-amount"
				onChange={s.setText}
				onCurrencyChange={s.setCurrency}
				value={s.text}
			/>
			{(all || c.parts.length > 0) && (
				<FilterChips>
					{all && (
						<FilterChip
							onClick={() => s.fill(all, true)}
							selected={s.everything}
						>
							{t("everything")} <Money value={all} />
						</FilterChip>
					)}
					{c.parts.map((p) => (
						<FilterChip
							key={p.currency}
							onClick={() => s.fill(p.full, false, p.currency)}
							selected={s.part === p.currency}
						>
							{t("part", { currency: p.currency })} <Money value={p.full} />
						</FilterChip>
					))}
				</FilterChips>
			)}
			{c.unpriced.length > 0 && (
				<p className="text-fg-3 text-meta">
					{t("unpriced", { currencies: c.unpriced.join(", ") })}
				</p>
			)}
		</div>
	);
}

/** Method, date and note: details of the record, they change no money. */
function Details({ s, methods }: { s: SettleState; methods: string[] }) {
	const methodName = useMethodName();
	const t = useTranslations("settleSheet");
	const { short } = useRowDates();
	const c = s.ctx;
	if (!c) return null;
	const all = [...new Set([...methods, ...GENERIC])];
	return (
		<>
			<div className="flex flex-col gap-2">
				<span className="text-fg text-small font-medium">{t("method")}</span>
				<FilterChips>
					{all.map((m) => (
						<FilterChip
							key={m}
							onClick={() => s.setMethod(s.method === m ? null : m)}
							selected={s.method === m}
						>
							{methodName(m)}
						</FilterChip>
					))}
				</FilterChips>
			</div>
			<div className="flex flex-col gap-2">
				<span className="text-fg text-small font-medium">{t("date")}</span>
				<FilterChips>
					{[
						{ day: c.today, label: t("today") },
						{ day: c.yesterday, label: t("yesterday") },
					].map((d) => (
						<FilterChip
							key={d.day}
							onClick={() => s.setPaidOn(d.day)}
							selected={s.paidOn === d.day}
						>
							{d.label} <span className="text-fg-3">{short(d.day)}</span>
						</FilterChip>
					))}
				</FilterChips>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="settle-note">{t("note")}</Label>
				<Input
					autoComplete="off"
					id="settle-note"
					maxLength={500}
					onChange={(e) => s.setNote(e.target.value)}
					value={s.note}
				/>
			</div>
		</>
	);
}

export function SettleForm({
	s,
	person,
	face,
	me,
	methods,
}: {
	s: SettleState;
	person: PersonIdentityDTO;
	face: FaceRef;
	me: FaceRef;
	methods: string[];
}) {
	return (
		<div className="flex flex-col gap-4">
			<Head face={face} me={me} person={person} s={s} />
			<OwesLine person={person} s={s} />
			<Amount s={s} />
			<Details methods={methods} s={s} />
		</div>
	);
}

/** What is open between you, from the server's lines, one currency at a time. */
function OwesLine({
	s,
	person,
}: {
	s: SettleState;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("settleSheet");
	const c = s.ctx;
	if (!c?.lines.length) return null;
	return (
		<ul
			aria-label={t("open")}
			className="text-fg-2 text-small flex flex-col gap-1"
		>
			{c.lines.map((l) => (
				<li
					className="flex justify-between gap-3"
					key={`${l.project?.id ?? "-"}-${l.amount.currency}`}
				>
					<span className="truncate">{l.project?.name || t("outside")}</span>
					<span className="whitespace-nowrap">
						{l.amount.minor > 0
							? t("owesYou", { name: person.name })
							: t("youOwe", { name: person.name })}{" "}
						<Money
							className="text-fg font-medium"
							sign="never"
							value={l.amount}
						/>
					</span>
				</li>
			))}
		</ul>
	);
}

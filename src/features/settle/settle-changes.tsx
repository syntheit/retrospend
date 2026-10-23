"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Balance } from "~/components/money/balance";
import { Money } from "~/components/money/money";
import type { PersonIdentityDTO } from "~/features/people/types";
import type { SettleState } from "./use-settle";

type Preview = NonNullable<SettleState["preview"]>;
type Change = Preview["changes"][number];

const zero = (currency: string) => ({ minor: 0, currency });

/** One figure that moves, before and after (R30). */
function ChangeRow({
	change,
	person,
}: {
	change: Change;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("settleSheet.changes");
	const before = change.before ?? zero(change.currency);
	const after = change.after ?? zero(change.currency);
	const label =
		change.id === "balance.person"
			? t("balance", { name: person.name, currency: change.currency })
			: change.id === "owed.owedToYou"
				? t("owedToYou")
				: t("youOwe");
	const show = (m: { minor: number; currency: string }) =>
		change.id === "balance.person" ? (
			<Balance amount={m} />
		) : (
			<Money className="text-fg" value={m} />
		);
	return (
		<div className="border-line flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2">
			<span className="text-fg-2 text-small">{label}</span>
			<span className="text-small flex items-center gap-2">
				<span className="text-fg-3">{show(before)}</span>
				<ArrowRight aria-hidden="true" className="text-fg-3 size-3" />
				{show(after)}
			</span>
		</div>
	);
}

/** What this changes, and what was checked and does not change. */
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
	return (
		<section
			aria-label={done ? t("doneTitle") : t("title")}
			className="flex flex-col"
		>
			<h3 className="text-fg text-small border-line border-b pb-1 font-semibold">
				{done ? t("doneTitle") : t("title")}
			</h3>
			{preview.changes.map((c) => (
				<ChangeRow change={c} key={`${c.id}-${c.currency}`} person={person} />
			))}
			{preview.unchanged.length > 0 && (
				<p className="text-fg-2 text-small pt-2">
					{t("nothingElse", {
						list: preview.unchanged.map((u) => name(u.id)).join(", "),
					})}
				</p>
			)}
			{preview.unavailable.length > 0 && (
				<p className="text-fg-3 text-meta pt-1">
					{t("unavailable", {
						list: preview.unavailable.map((u) => name(u.id)).join(", "),
					})}
				</p>
			)}
		</section>
	);
}

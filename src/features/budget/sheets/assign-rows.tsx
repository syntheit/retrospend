"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Money } from "~/components/money/money";
import { MoneyCell } from "~/components/money/money-cell";
import { Row, RowList, RowSub } from "~/components/rows/row";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { EnvelopeTile } from "./envelope-tile";
import type { EnvelopeInGroup } from "./use-month";

export type AssignRowsProps = {
	cover: EnvelopeInGroup[];
	fund: EnvelopeInGroup[];
	other: EnvelopeInGroup[];
	/** The saved plan is the source of the fund rows ("Your plan"). */
	fromPlan: boolean;
	texts: Record<string, string>;
	invalid: ReadonlySet<string>;
	currency: string;
	onChange: (envelopeId: string, text: string) => void;
};

/** One titled group of envelope rows with an amount each. */
function Block({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className="mt-4 first:mt-0">
			<h3 className="text-fg text-small mb-1 font-semibold">{title}</h3>
			<RowList variant="flat">{children}</RowList>
		</section>
	);
}

function Hint({ e }: { e: EnvelopeInGroup }) {
	const t = useTranslations("budgetSheets.assign");
	if (e.status === "OVERSPENT")
		return (
			<RowSub
				parts={[
					t.rich("over", {
						amount: () => <Money sign="never" value={e.left} />,
					}),
				]}
			/>
		);
	const need = e.target?.need;
	return need && need.minor > 0 ? (
		<RowSub
			parts={[t.rich("needs", { amount: () => <Money value={need} /> })]}
		/>
	) : (
		<RowSub parts={[e.target ? t("funded") : t("noTarget")]} />
	);
}

function AssignRow({
	e,
	text,
	invalid,
	currency,
	onChange,
}: {
	e: EnvelopeInGroup;
	text: string;
	invalid: boolean;
	currency: string;
	onChange: (envelopeId: string, text: string) => void;
}) {
	const t = useTranslations("budgetSheets.assign");
	return (
		<Row
			end={
				<MoneyCell
					currency={currency}
					invalid={invalid}
					label={t("amountFor", { name: e.name })}
					onChange={(next) => onChange(e.id, next)}
					value={text}
				/>
			}
			lead={<EnvelopeTile envelope={e} />}
			sub={<Hint e={e} />}
			title={e.name}
		/>
	);
}

/** The envelopes of the assign sheet in the order the person needs them. */
export function AssignRows(p: AssignRowsProps) {
	const t = useTranslations("budgetSheets.assign");
	const row = (e: EnvelopeInGroup) => (
		<AssignRow
			currency={p.currency}
			e={e}
			invalid={p.invalid.has(e.id)}
			key={e.id}
			onChange={p.onChange}
			text={p.texts[e.id] ?? ""}
		/>
	);
	return (
		<div>
			{p.cover.length > 0 ? (
				<Block title={t("coverTitle")}>{p.cover.map(row)}</Block>
			) : null}
			{p.fund.length > 0 ? (
				<Block title={p.fromPlan ? t("planTitle") : t("fundTitle")}>
					{p.fund.map(row)}
				</Block>
			) : null}
			{p.other.length > 0 ? (
				<Collapsible
					className="mt-4"
					defaultOpen={p.cover.length + p.fund.length === 0}
				>
					<CollapsibleTrigger className="text-fg text-small focus-visible:outline-brand flex w-full items-center gap-2 font-semibold focus-visible:outline-2">
						{t("otherTitle")}
						<span className="text-fg-3 font-normal tabular-nums">
							{p.other.length}
						</span>
						<ChevronDown aria-hidden="true" className="ml-auto size-4" />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<RowList className="mt-1" variant="flat">
							{p.other.map(row)}
						</RowList>
					</CollapsibleContent>
				</Collapsible>
			) : null}
		</div>
	);
}

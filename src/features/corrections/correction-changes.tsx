"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import type { CorrectResult } from "~/lib/schemas/corrections";
import { ChangesBlock } from "../entry/changes";

type Diff = React.ComponentProps<typeof ChangesBlock>["diff"];

/** The person a difference names, as the contract keys one. */
export const personKey = (p: { type: string; id: string }) =>
	`${p.type}:${p.id}`;

/**
 * One line per person whose paid or share moved, signed: "Lucía's share
 * -ARS 6,000". The server states each difference (R9); this only names the
 * person and lays the figure out.
 */
function Differences({
	differences,
	currency,
	names,
	me,
}: {
	differences: CorrectResult["differences"];
	currency: string;
	names: ReadonlyMap<string, string>;
	/** The viewer's person key: their lines say "Your share" and "You paid". */
	me: string;
}) {
	const t = useTranslations("corrections.correct");
	const lines = differences.flatMap((d) => {
		const key = personKey(d.participant);
		const name = names.get(key) ?? t("someone");
		const you = key === me;
		return [
			...(d.shareMinor === 0
				? []
				: [
						{
							key: `${key}-share`,
							label: you ? t("shareYou") : t("share", { name }),
							minor: d.shareMinor,
						},
					]),
			...(d.paidMinor === 0
				? []
				: [
						{
							key: `${key}-paid`,
							label: you ? t("paidYou") : t("paid", { name }),
							minor: d.paidMinor,
						},
					]),
		];
	});
	return (
		<>
			{lines.map((l) => (
				<div
					className="text-small flex min-h-6 items-baseline justify-between gap-3"
					key={l.key}
				>
					<span className="text-fg-2">{l.label}</span>
					<Money sign="exceptZero" value={{ minor: l.minor, currency }} />
				</div>
			))}
		</>
	);
}

/**
 * What this correction changes (R30): the difference per person, then the
 * figures the write moves, then what was checked and stays. Only the
 * difference is recorded; the original expense stays as it was.
 */
export function CorrectionChanges({
	result,
	diff,
	names,
	me,
	loading,
	error,
}: {
	result: CorrectResult | null;
	diff: Diff;
	names: ReadonlyMap<string, string>;
	me: string;
	loading: boolean;
	error: string | null;
}) {
	const t = useTranslations("corrections.correct");
	const nothing = result !== null && result.transactionIds.length === 0;
	return (
		<ChangesBlock
			byDesign={["accounts", "netWorth"]}
			cannot={error}
			diff={nothing ? null : diff}
			empty={nothing ? t("nothing") : t("empty")}
			loading={loading}
			rows={
				result && !nothing ? (
					<Differences
						currency={result.currency}
						differences={result.differences}
						me={me}
						names={names}
					/>
				) : null
			}
		/>
	);
}

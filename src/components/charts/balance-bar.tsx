"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { MoneyValue } from "~/components/money/format";
import type { Basis } from "~/components/rows/types";
import { Face, type FacePerson, faceColor } from "~/components/ui/avatar-face";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import { ChartEmpty, useMoneyText } from "./chart-frame";
import { COLOR, seriesColor, THIN } from "./spec";

export type BalanceSegment = {
	person: FacePerson;
	direction: "owed" | "owe";
	/** Their part of owed plus owe, from the server, largest first per side. */
	share: Basis;
	/** Their balance, for the segment's tooltip. */
	amount: MoneyValue;
};

/** A person's series slot follows their avatar color, so it never changes. */
function personSeries(name: string): string {
	return seriesColor(Number(faceColor(name).replace("bg-avatar-", "")));
}

/** Faces above the bar: the biggest owed segments, then the biggest you owe. */
function facesFor(segments: BalanceSegment[], phone: boolean) {
	const min = phone ? 1100 : 600;
	const owed = segments
		.filter((s) => s.direction === "owed" && s.share >= min)
		.slice(0, phone ? 3 : 5);
	const owe = segments.find((s) => s.direction === "owe");
	return owe ? [...owed, owe] : owed;
}

/**
 * Balance bar (People, Direction A, N57): who makes up what you are owed and
 * what you owe, as one two-sided bar. Owed segments take each person's
 * identity color, you-owe segments are hatched neutral after a gap, and the
 * biggest have their face above them. Owed to you and You owe stay two
 * figures (D1): the page shows both totals; this bar only lays them out.
 */
export function BalanceBar({
	segments,
	owedToYou,
	youOwe,
	phone = false,
}: {
	segments: BalanceSegment[];
	owedToYou: MoneyValue;
	youOwe: MoneyValue;
	phone?: boolean;
}) {
	const t = useTranslations("charts");
	const text = useMoneyText();
	const hatch = useId();
	const owed = segments.filter((s) => s.direction === "owed");
	const owe = segments.filter((s) => s.direction === "owe");
	const faces = facesFor(segments, phone);
	const total = segments.reduce((sum, s) => sum + s.share, 0) || 1;
	const centers = new Map<BalanceSegment, number>();
	let at = 0;
	for (const s of [...owed, ...owe]) {
		centers.set(s, ((at + s.share / 2) / total) * 100);
		at += s.share;
	}
	if (!segments.length) return <ChartEmpty height={THIN.balance * 4} />;
	const seg = (s: BalanceSegment) => (
		<Tip
			content={t(
				s.direction === "owed" ? "balance.owesYou" : "balance.youOwe",
				{
					name: s.person.name,
					amount: text(s.amount),
				},
			)}
			key={`${s.direction}-${s.person.id}`}
		>
			<span
				className="relative block h-full min-w-1 overflow-hidden"
				style={{
					flex: `${s.share} 1 0`,
					background:
						s.direction === "owed" ? personSeries(s.person.name) : COLOR.track,
				}}
			>
				{s.direction === "owe" && (
					<svg aria-hidden="true" className="absolute inset-0 size-full">
						<rect fill={`url(#${hatch})`} height="100%" width="100%" />
					</svg>
				)}
			</span>
		</Tip>
	);
	return (
		<div
			aria-label={t("balance.summary", {
				owed: text(owedToYou),
				owe: text(youOwe),
			})}
			role="img"
		>
			<svg aria-hidden="true" className="absolute size-0">
				<defs>
					<pattern
						height="6"
						id={hatch}
						patternTransform="rotate(45)"
						patternUnits="userSpaceOnUse"
						width="6"
					>
						<rect fill={COLOR.label} height="6" width="2" />
					</pattern>
				</defs>
			</svg>
			<div
				aria-hidden="true"
				className={cn("relative", phone ? "h-8" : "h-10")}
			>
				{faces.map((s) => (
					<span
						className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center"
						key={`f-${s.direction}-${s.person.id}`}
						style={{ left: `${centers.get(s) ?? 0}%` }}
					>
						<Face
							imageUrl={s.person.imageUrl}
							name={s.person.name}
							size={phone ? "sm" : "default"}
						/>
						<span className="bg-line-strong h-1 w-px" />
					</span>
				))}
			</div>
			<div
				className="rounded-chip flex overflow-hidden"
				style={{ height: THIN.balance, gap: THIN.gap }}
			>
				{owed.map(seg)}
				{owe.length > 0 && owed.length > 0 && (
					<span aria-hidden="true" className="w-3 shrink-0" />
				)}
				{owe.map(seg)}
			</div>
		</div>
	);
}

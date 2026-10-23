"use client";

import { useTranslations } from "next-intl";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { MoneyValue } from "~/components/money/format";
import type { Basis } from "~/components/rows/types";
import { Face, type FacePerson, faceColor } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
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

const keyOf = (s: BalanceSegment) => `${s.direction}-${s.person.id}`;

/**
 * Where each face sits: over its segment's measured center (so the gaps and
 * the side gap count), held inside the bar so a small last segment's face
 * never hangs past the edge. Re-measured when the bar resizes.
 */
function useFaceSpots(faceSize: number, layout: string) {
	const bar = useRef<HTMLDivElement>(null);
	const segs = useRef(new Map<string, HTMLElement>());
	const [spots, setSpots] = useState<Map<string, number>>(() => new Map());
	useLayoutEffect(() => {
		const el = bar.current;
		if (!el) return;
		const measure = () => {
			const width = el.clientWidth;
			const half = faceSize / 2;
			const next = new Map<string, number>();
			for (const [key, seg] of segs.current) {
				const center = seg.offsetLeft + seg.offsetWidth / 2;
				next.set(key, Math.min(Math.max(center, half), width - half));
			}
			setSpots(next);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [faceSize, layout]);
	const track = (key: string) => (node: HTMLElement | null) => {
		if (node) segs.current.set(key, node);
		else segs.current.delete(key);
	};
	return { bar, spots, track };
}

/**
 * Balance bar (People, Direction A, N57): who makes up what you are owed and
 * what you owe, as one two-sided bar. Owed segments take each person's
 * identity color, you-owe segments are hatched neutral after a gap, and the
 * biggest have their face above them. With `onSegment` each segment is a
 * button that takes you to that person (their row). Owed to you and You owe
 * stay two figures (D1): the page shows both totals; this bar lays them out.
 */
export function BalanceBar({
	segments,
	owedToYou,
	youOwe,
	phone = false,
	onSegment,
}: {
	segments: BalanceSegment[];
	owedToYou: MoneyValue;
	youOwe: MoneyValue;
	phone?: boolean;
	/** Goes to the person behind a segment (People scrolls to their row). */
	onSegment?: (person: FacePerson) => void;
}) {
	const t = useTranslations("charts");
	const text = useMoneyText();
	const hatch = useId();
	const faceSize = phone ? 24 : 32;
	const layout = segments.map((s) => `${keyOf(s)}:${s.share}`).join(",");
	const { bar, spots, track } = useFaceSpots(faceSize, layout);
	const owed = segments.filter((s) => s.direction === "owed");
	const owe = segments.filter((s) => s.direction === "owe");
	const faces = facesFor(segments, phone);
	if (!segments.length) return <ChartEmpty height={THIN.balance * 4} />;
	const label = (s: BalanceSegment) =>
		t(s.direction === "owed" ? "balance.owesYou" : "balance.youOwe", {
			name: s.person.name,
			amount: text(s.amount),
		});
	const seg = (s: BalanceSegment) => {
		// The hatch clips to its own rounded box, so a button's taller hit area
		// (below) is not clipped with it.
		const fill =
			s.direction === "owe" ? (
				<span
					aria-hidden="true"
					className="rounded-chip absolute inset-0 overflow-hidden"
				>
					<svg aria-hidden="true" className="size-full">
						<rect fill={`url(#${hatch})`} height="100%" width="100%" />
					</svg>
				</span>
			) : null;
		const look = "rounded-chip relative block h-full min-w-1";
		// The bar is 12px; its buttons reach 44px on phones and 28px on
		// desktop (§14 targets) through an invisible area above and below.
		const hit = phone
			? "after:absolute after:-inset-y-4 after:inset-x-0 after:content-['']"
			: "after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']";
		const style = {
			flex: `${s.share} 1 0`,
			background:
				s.direction === "owed" ? personSeries(s.person.name) : COLOR.track,
		};
		return (
			<Tip content={label(s)} key={keyOf(s)}>
				{onSegment ? (
					<Button
						aria-label={label(s)}
						className={cn(look, hit, "h-full border-0 p-0")}
						kind="ghost"
						onClick={() => onSegment(s.person)}
						ref={track(keyOf(s))}
						style={style}
					>
						{fill}
					</Button>
				) : (
					<span className={look} ref={track(keyOf(s))} style={style}>
						{fill}
					</span>
				)}
			</Tip>
		);
	};
	const summary = t("balance.summary", {
		owed: text(owedToYou),
		owe: text(youOwe),
	});
	return (
		<div aria-label={summary} role={onSegment ? "group" : "img"}>
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
				{faces.map((s) => {
					const left = spots.get(keyOf(s));
					return (
						<span
							className={cn(
								"absolute bottom-0 flex -translate-x-1/2 flex-col items-center",
								left == null && "invisible",
							)}
							key={`f-${keyOf(s)}`}
							style={{ left: left ?? 0 }}
						>
							<Face
								imageUrl={s.person.imageUrl}
								name={s.person.name}
								size={phone ? "sm" : "default"}
							/>
							<span className="bg-line-strong h-1 w-px" />
						</span>
					);
				})}
			</div>
			<div
				className="relative flex"
				ref={bar}
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

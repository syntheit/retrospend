"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/cn";
import { importable, isKept } from "./choices";
import { PossibleFlag, type ReviewBodyProps } from "./review-table";
import {
	amountFigure,
	CategoryCell,
	homeFigure,
	KindCell,
} from "./row-controls";

/** How far a card travels before a release keeps or skips it. */
const SWIPE_PX = 90;

/**
 * Review as cards (import.html Cards, the phone default): one row at a
 * time, Keep or Skip, or swipe right to keep and left to skip. The card
 * only follows the finger; reduced motion keeps it still (opacity only).
 */
export function ReviewCards({
	rows,
	choices,
	pick,
	onChoice,
	onKind,
	fileName,
	footer,
}: ReviewBodyProps & { fileName: string; footer: React.ReactNode }) {
	const t = useTranslations("importPage.cards");
	const { day } = useRowDates();
	const queue = rows.filter(importable);
	const [at, setAt] = useState(0);
	const [dx, setDx] = useState(0);
	const start = useRef<number | null>(null);
	const kept = queue.filter((r) => isKept(r, choices)).length;
	const n = queue.length;
	const pct = n ? Math.round((Math.min(at, n) / n) * 100) : 100;
	const decide = (keep: boolean) => {
		const r = queue[at];
		if (!r) return;
		onChoice(r.index, { keep });
		setAt(at + 1);
		setDx(0);
	};
	const top = (
		<div className="w-full max-w-105">
			<div className="text-fg-2 text-small mb-2 flex justify-between">
				<span>{t("progress", { n: Math.min(at + 1, n), total: n })}</span>
				<span>{t("kept", { count: kept })}</span>
			</div>
			<Progress
				aria-label={t("progress", { n: Math.min(at + 1, n), total: n })}
				value={pct}
			/>
		</div>
	);
	const r = queue[at];
	if (!r)
		return (
			<div className="flex flex-col items-center gap-4">
				{top}
				<Empty
					action={
						n > 0 ? (
							<Button kind="ghost" onClick={() => setAt(n - 1)} size="sm">
								{t("backToCards")}
							</Button>
						) : null
					}
					hint={t("readyHint", { skipped: n - kept })}
					icon={CircleCheck}
					title={t("ready", { count: kept })}
				/>
				{footer}
			</div>
		);
	const c = choices[r.index];
	return (
		<div
			className="flex flex-col items-center gap-4"
			data-testid="import-cards"
		>
			{top}
			<article
				aria-label={r.title}
				className={cn(
					"rounded-panel border-line bg-surface relative flex w-full max-w-105 touch-pan-y flex-col gap-4 border p-6 select-none motion-reduce:transform-none",
					start.current == null &&
						"ease-land transition-transform duration-(--t-menu)",
				)}
				data-index={r.index}
				onPointerCancel={() => {
					start.current = null;
					setDx(0);
				}}
				onPointerDown={(e) => {
					if ((e.target as HTMLElement).closest("button")) return;
					start.current = e.clientX;
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => {
					if (start.current != null) setDx(e.clientX - start.current);
				}}
				onPointerUp={() => {
					if (start.current == null) return;
					start.current = null;
					if (dx > SWIPE_PX) decide(true);
					else if (dx < -SWIPE_PX) decide(false);
					else setDx(0);
				}}
				style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
			>
				<div>
					<p className="text-fg text-section font-semibold">{r.title}</p>
					<p className="text-fg-3 text-meta">
						{day(r.date)} · {t("from", { file: fileName })}
					</p>
				</div>
				<Money
					className="text-fg text-hero font-semibold"
					figure={amountFigure(r)}
					value={r.amount}
				/>
				{r.home && r.home.currency !== r.amount.currency ? (
					<p className="text-fg-2 text-small">
						{t("about")} <Money figure={homeFigure(r)} value={r.home} />
					</p>
				) : null}
				{r.possible ? (
					<PossibleFlag kept={false} onSkip={() => {}} r={r} />
				) : null}
				{c ? (
					<div className="flex flex-wrap gap-2">
						<KindCell
							onChange={(k) => onKind(r.index, k)}
							r={r}
							value={c.kind}
						/>
						<CategoryCell
							kind={c.kind}
							onChange={(id) => onChoice(r.index, { categoryId: id })}
							pick={pick}
							r={r}
							value={c.categoryId}
						/>
					</div>
				) : null}
			</article>
			<div className="flex w-full max-w-105 gap-2">
				<Button
					className="flex-1"
					kind="secondary"
					onClick={() => decide(false)}
				>
					{t("skip")}
				</Button>
				<Button className="flex-1" kind="primary" onClick={() => decide(true)}>
					{t("keep")}
				</Button>
			</div>
			<p className="text-fg-3 text-meta">{t("hint")}</p>
		</div>
	);
}

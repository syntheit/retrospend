"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
import { useRateTypeName } from "~/features/people/rate-type";
import type { BalancePart, PersonPage } from "~/features/people/types";
import { cn } from "~/lib/cn";

/** Which way a balance points, as the page words and colors it. */
export function directionOf(page: PersonPage): "owed" | "owe" | null {
	if (!page.parts.length) return null;
	const sign = page.net ? page.net.minor : (page.parts[0]?.amount.minor ?? 0);
	return sign >= 0 ? "owed" : "owe";
}

/** One currency line: its amount, then what it is worth at home and at which rate. */
function PartLine({ part, mixed }: { part: BalancePart; mixed: boolean }) {
	const t = useTranslations("personPage.balance");
	const typeName = useRateTypeName();
	const owed = part.amount.minor > 0;
	const rate = part.rate;
	return (
		<div className="border-line flex items-baseline gap-3 border-t py-2">
			<span className="text-fg-3 text-meta w-12 shrink-0 font-medium">
				{part.amount.currency}
			</span>
			<span
				className={cn(
					"text-body font-semibold",
					owed ? "text-positive" : "text-owe",
				)}
			>
				<Money sign="never" value={part.amount} />
				{mixed && (
					<span className="text-fg-2 font-normal">
						{" "}
						{owed ? t("owedToYou") : t("youOwe")}
					</span>
				)}
			</span>
			<span className="text-fg-3 text-meta ml-auto text-right">
				{rate && part.home ? (
					<>
						{t.rich("worth", {
							amount: () => <Money sign="never" value={part.home} />,
						})}{" "}
						{t.rich("at", {
							type: typeName(rate.type),
							rate: () => <Money value={rate.value} />,
						})}
					</>
				) : part.home ? null : (
					t("noRate")
				)}
			</span>
		</div>
	);
}

/**
 * The balance with this person: one net line in the home currency, each
 * currency under it with its rate (RC5), your payments still waiting for
 * them, and Remind when they owe you.
 */
export function BalanceBlock({
	page,
	onRemind,
	reminding,
}: {
	page: PersonPage;
	onRemind?: () => void;
	reminding?: boolean;
}) {
	const t = useTranslations("personPage.balance");
	const { short } = useRowDates();
	const p = page.person;
	const dir = directionOf(page);
	const pending = page.payments.filter(
		(y) => y.status === "pending" && y.recordedByMe,
	);
	const mixed =
		page.parts.some((x) => x.amount.minor > 0) &&
		page.parts.some((x) => x.amount.minor < 0);
	const foreign =
		page.parts.length > 1 ||
		(page.parts[0] && page.parts[0].amount.currency !== page.home);
	if (!dir)
		return (
			<div>
				<div className="text-fg-2 text-section font-normal">
					{t("youAnd", { name: p.name })}
				</div>
				<div className="text-fg-2 text-title mt-1 flex flex-wrap items-baseline gap-2">
					{page.settled.nothingShared ? t("nothingShared") : t("settled")}
					{page.settled.since && (
						<span className="text-fg-3 text-small font-normal">
							{page.settled.pending
								? t("settledPending", { date: short(page.settled.since) })
								: t("settledSince", { date: short(page.settled.since) })}
						</span>
					)}
				</div>
			</div>
		);
	return (
		<div>
			<div className="text-fg-2 text-section font-normal">
				{t(dir === "owed" ? "owesYou" : "youOweThem", { name: p.name })}
				{page.parts.length > 1 ? t("net") : ""}
			</div>
			<Money
				// A net across currencies is converted at today's rates (person.html).
				approx={!!foreign}
				className={cn(
					"text-hero mt-1 block",
					dir === "owed" ? "text-positive" : "text-owe",
				)}
				missing="noRate"
				sign="never"
				value={page.net}
			/>
			{foreign && (
				<div className="mt-3 max-w-120">
					{page.parts.map((part) => (
						<PartLine key={part.amount.currency} mixed={mixed} part={part} />
					))}
				</div>
			)}
			{pending.map((y) => (
				<div
					className="text-small mt-3 flex flex-wrap items-center gap-2"
					key={y.id}
				>
					<StatusDot kind="pending" size="sm" />
					<span className="text-fg-2">
						{t.rich("pendingPaid", {
							name: p.name,
							amount: () => <Money value={y.amount} />,
							date: short(y.paidOn),
						})}
					</span>
				</div>
			))}
			{dir === "owed" &&
				(p.onRetrospend ? (
					onRemind && (
						<Button
							className="mt-3 px-0 max-md:hidden"
							disabled={reminding}
							kind="ghost"
							onClick={onRemind}
							size="sm"
						>
							<Bell aria-hidden="true" />
							{t("remind", { name: p.name })}
						</Button>
					)
				) : (
					<p className="text-fg-3 text-meta mt-3">{t("notOnRetrospend")}</p>
				))}
		</div>
	);
}

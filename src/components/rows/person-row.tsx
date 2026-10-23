"use client";

import { Banknote } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Balance } from "~/components/money/balance";
import { signOf } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import {
	Row,
	type RowPassThrough,
	RowSub,
	type RowVariant,
	useRowVariant,
} from "./row";
import type { PersonVM } from "./types";

/** Classes that show a part on desktop lists only, or on phones only. */
function sides(variant: RowVariant) {
	return {
		wide:
			variant === "flat"
				? ""
				: variant === "group"
					? "hidden"
					: "max-md:hidden",
		narrow:
			variant === "flat" ? "hidden" : variant === "group" ? "" : "md:hidden",
	};
}

/** The face, with the attention dot when something changed since you looked. */
function PersonLead({ person }: { person: PersonVM }) {
	const variant = useRowVariant();
	return (
		<span className="relative inline-flex shrink-0">
			<Face imageUrl={person.imageUrl} name={person.name} size="md" />
			{(person.unseen ?? 0) > 0 && (
				<span
					aria-hidden="true"
					className={cn(
						"bg-attention absolute -top-px -right-px size-2.5 rounded-full ring-2",
						variant === "group"
							? "ring-surface"
							: variant === "auto"
								? "ring-bg max-md:ring-surface"
								: "ring-bg",
					)}
					data-slot="unseen-dot"
				/>
			)}
		</span>
	);
}

/**
 * Under the net: the balance in each currency as it is held, when it is
 * not one amount in the home currency. Desktop lists every part ("ARS
 * 802,352 · BRL 402.50", each with its words when they point both ways);
 * phones say how many currencies, or the one foreign part.
 */
function Parts({ parts }: { parts: PersonVM["parts"] }) {
	const t = useTranslations("rows.person");
	const words = useTranslations("kit.balance");
	const { wide, narrow } = sides(useRowVariant());
	if (!parts?.length) return null;
	const mixed = new Set(parts.map(signOf)).size > 1;
	const muted = "text-fg-3 text-meta whitespace-nowrap";
	const part = (p: NonNullable<PersonVM["parts"]>[number]) => (
		<Money className={muted} sign="never" value={p} />
	);
	return (
		<>
			<span className={cn(muted, "flex flex-wrap justify-end gap-x-2", wide)}>
				{parts.map((p, i) => (
					<span key={p.currency}>
						{i > 0 && <span aria-hidden="true">· </span>}
						{part(p)}
						{mixed && ` ${words(signOf(p) > 0 ? "owedToYou" : "youOwe")}`}
					</span>
				))}
			</span>
			<span className={cn(muted, narrow)}>
				{parts.length > 1
					? t("currencies", { count: parts.length })
					: parts[0] && part(parts[0])}
			</span>
		</>
	);
}

/** A payment waiting for one side: the Pending word and who paid what. */
function Pending({ pending }: { pending: NonNullable<PersonVM["pending"]> }) {
	const t = useTranslations("rows.person");
	return (
		<span className="flex flex-col items-end">
			<StatusDot kind="pending" size="sm" />
			<span className="text-fg-2 text-small whitespace-nowrap">
				{t(pending.direction === "out" ? "youPaid" : "paidYou")}{" "}
				<Money value={pending.amount} />
			</span>
		</span>
	);
}

/**
 * PersonRow (people.html): a person with one balance. The net is the
 * server's; a net across currencies reads "≈" and lists its parts under
 * it. A pending payment takes the balance's place. "Not on Retrospend" and
 * what waits for you are statuses that never cut; phones put them on their
 * own line. Desktop rows show Settle up on hover (its twin is in the menu).
 */
export function PersonRow({
	person,
	actions,
	onSettle,
	words = true,
	...rest
}: {
	person: PersonVM;
	actions?: ReactNode;
	/** The hover Settle up on desktop; the menu and the S key have the same action. */
	onSettle?: () => void;
	/** False inside a group whose heading says the direction ("Owe you"). */
	words?: boolean;
} & RowPassThrough) {
	const t = useTranslations("rows.person");
	const variant = useRowVariant();
	const { wide, narrow } = sides(variant);
	const settled = signOf(person.balance) === 0;
	// Statuses never cut: on a desktop line they keep their width; on a
	// phone's own line they wrap between words rather than lose one.
	const status = (kind: "review" | "notOnRetrospend", label?: string) => (
		<StatusDot
			className="whitespace-normal"
			key={label ?? kind}
			kind={kind}
			label={label}
			size="sm"
		/>
	);
	const statusList = [
		(person.unseen ?? 0) > 0 &&
			status("review", t("new", { count: person.unseen ?? 0 })),
		(person.needsYou ?? 0) > 0 &&
			status("review", t("needYou", { count: person.needsYou ?? 0 })),
		!person.onRetrospend && status("notOnRetrospend"),
	].filter((s) => s !== false);
	const statuses = statusList.map((s) => ({ keep: s }));
	const shared = [
		{ shrink: person.lastShared },
		person.when && { keep: person.when },
	];
	const balance = person.pending ? (
		<Pending pending={person.pending} />
	) : (
		<span className="flex flex-col items-end">
			<Balance
				amount={person.balance}
				approx={person.approx}
				className={
					words && variant === "group"
						? "flex flex-col items-end"
						: words && variant === "auto"
							? "max-md:flex max-md:flex-col max-md:items-end"
							: undefined
				}
				figure={person.figure}
				words={words}
			/>
			{!settled && <Parts parts={person.parts} />}
		</span>
	);
	const settle = onSettle && !person.pending && !settled && (
		<Button
			className={cn(
				"can-hover:opacity-0 can-hover:group-hover/row:opacity-100 can-hover:focus-within:opacity-100 focus-visible:opacity-100",
				wide,
			)}
			kind="ghost"
			onClick={onSettle}
			size="sm"
		>
			<Banknote aria-hidden="true" />
			{t("settleUp")}
		</Button>
	);
	return (
		<Row
			{...rest}
			actions={actions}
			end={
				settle ? (
					<span className="flex items-center gap-4">
						{settle}
						{balance}
					</span>
				) : (
					balance
				)
			}
			lead={<PersonLead person={person} />}
			open={{ href: person.href }}
			sub={
				<>
					<RowSub className={wide} parts={[...statuses, ...shared]} />
					<RowSub className={narrow} parts={shared} />
					{statusList.length > 0 && (
						<div
							className={cn(
								"text-meta mt-px flex flex-wrap gap-x-2 gap-y-0.5",
								narrow,
							)}
						>
							{statusList}
						</div>
					)}
				</>
			}
			title={person.name}
		/>
	);
}

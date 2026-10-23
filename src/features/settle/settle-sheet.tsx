"use client";

import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatMoney } from "~/components/money/format";
import { Empty } from "~/components/ui/empty-state";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { firstName } from "~/features/people/filter";
import type { PersonIdentityDTO } from "~/features/people/types";
import { useSession } from "~/hooks/use-session";
import { api, type RouterOutputs } from "~/trpc/react";
import { Changes } from "./settle-changes";
import { SettleForm } from "./settle-form";
import { SettlePreview } from "./settle-preview";
import { useSettle } from "./use-settle";

type Recorded = RouterOutputs["settlement"]["paymentRecord"];

/**
 * Settle up (IMPLEMENTATION §1.2, MONEY-MOVES §1): one payment with one
 * person. A dialog on desktop, a large detent sheet on a phone. It shows
 * the server's preview of exactly what Record writes before Save (R30), then
 * the recorded state, and the toast offers Undo (R15).
 */
export function SettleSheet({
	person,
	scope,
	onClose,
}: {
	person: PersonIdentityDTO | null;
	/** A project id, null for Outside projects; omitted for every scope. */
	scope?: string | null;
	onClose: () => void;
}) {
	// The last person stays rendered while the sheet animates closed.
	const [shown, setShown] = useState(person);
	useEffect(() => {
		if (person) setShown(person);
	}, [person]);
	if (!shown) return null;
	return (
		<SettleSheetFor
			key={`${shown.key}-${scope ?? "all"}`}
			onClose={onClose}
			open={person !== null}
			person={shown}
			scope={scope}
		/>
	);
}

function SettleSheetFor({
	person: full,
	scope,
	open,
	onClose,
}: {
	person: PersonIdentityDTO;
	scope?: string | null;
	open: boolean;
	onClose: () => void;
}) {
	// Sentences use the first name; the face keeps the full name (its color and initials).
	const person = { ...full, name: firstName(full.name) };
	const t = useTranslations("settleSheet");
	const locale = useLocale();
	const toast = useToast();
	const router = useRouter();
	const session = useSession();
	const s = useSettle(person, scope);
	const [done, setDone] = useState<Recorded | null>(null);
	const record = api.settlement.paymentRecord.useMutation();
	const undoRecord = api.people.undoPayment.useMutation();
	const unconfirm = api.settlement.paymentUnconfirm.useMutation();
	const methods = api.paymentMethod.match.useQuery(
		{ participantType: person.type, participantId: person.id },
		{
			enabled:
				open && person.type === "user" && s.ctx?.direction === "outgoing",
		},
	);
	const c = s.ctx;
	const me = {
		name: session.data?.user.name ?? "",
		imageUrl: session.data?.user.image ?? null,
	};
	const ready =
		!!s.input && !!s.preview && s.preview.value.recorded && !s.previewing;
	const amount =
		s.input && c ? (s.preview?.value.allocation?.amount ?? null) : null;

	const onSubmit = async () => {
		if (!s.input) return false;
		const input = s.input;
		const result = await record.mutateAsync(input);
		setDone(result);
		router.refresh();
		const paid = result.value.recorded ? result.value.allocation?.amount : null;
		const text = paid ? formatMoney(paid, { locale }) : "";
		toast.saved(
			input.matchClaimId
				? t("toast.confirmed", { name: person.name })
				: t(input.direction === "incoming" ? "toast.from" : "toast.to", {
						amount: text,
						name: person.name,
					}),
			{
				undo: async () => {
					if (!result.value.recorded) return;
					if (input.matchClaimId)
						await unconfirm.mutateAsync({ paymentId: result.value.paymentId });
					else
						await undoRecord.mutateAsync({ paymentId: result.value.paymentId });
					router.refresh();
				},
			},
		);
		return false;
	};

	const nothing = c && !c.lines.length && !done;
	return (
		<Sheet
			cancelLabel={done || nothing ? t("done") : undefined}
			detent="large"
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
			onSubmit={done || nothing ? undefined : onSubmit}
			open={open}
			submitDisabled={!ready}
			submitLabel={
				done || nothing
					? undefined
					: amount
						? t("recordAmount", { amount: formatMoney(amount, { locale }) })
						: t("record")
			}
			title={t("title", { name: person.name })}
		>
			{s.loading || !c ? (
				<SkeletonRows count={4} />
			) : done ? (
				<RecordedState done={done} person={person} />
			) : nothing ? (
				<Empty
					hint={t("evenHint", { name: person.name })}
					icon={CircleCheck}
					title={t("even")}
				/>
			) : (
				<div className="flex flex-col gap-6 pb-4">
					<SettleForm
						face={full}
						me={me}
						methods={(methods.data?.compatible ?? []).map((m) => m.type)}
						person={person}
						s={s}
					/>
					<SettlePreview person={person} s={s} />
					<p className="text-fg-3 text-meta">{ruleOf(t, s, person)}</p>
				</div>
			)}
		</Sheet>
	);
}

/** One line under the preview: why Record is off, or what happens after it. */
function ruleOf(
	t: ReturnType<typeof useTranslations<"settleSheet">>,
	s: ReturnType<typeof useSettle>,
	person: PersonIdentityDTO,
): string {
	if (!s.input) return t("rule.empty");
	if (
		s.preview?.value.recorded === false &&
		s.preview.value.reason === "overpay"
	)
		return t("rule.overpay");
	if (s.claimId) return t("rule.claim", { name: person.name });
	if (s.ctx?.direction === "incoming") return t("rule.received");
	return person.onRetrospend
		? t("rule.waits", { name: person.name })
		: t("rule.final", { name: person.name });
}

/** After Record: that it was written, whether it waits, and what changed. */
function RecordedState({
	done,
	person,
}: {
	done: Recorded;
	person: PersonIdentityDTO;
}) {
	const t = useTranslations("settleSheet.recorded");
	const pending = done.value.recorded && done.value.status === "PROPOSED";
	return (
		<div className="flex flex-col gap-4 pb-4">
			<div className="flex flex-col items-center gap-2 py-4 text-center">
				<CircleCheck aria-hidden="true" className="text-positive size-6" />
				<p className="text-fg text-body font-semibold">{t("title")}</p>
				<p className="text-fg-2 text-small">
					{pending ? t("pending", { name: person.name }) : t("final")}
				</p>
			</div>
			<Changes done person={person} preview={done} />
		</div>
	);
}

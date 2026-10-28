import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { minorOf, readAmount } from "./amount";
import { ChoiceList } from "./fields";
import { affordQuery } from "./moreBodies";
import { AmountField, Note, SheetBody, useAmountLocale } from "./parts";
import { type BudgetMonth, envelopesOf } from "./source";

type Answer = NonNullable<
	Awaited<ReturnType<RetrospendClient["budget"]["afford"]>>
>;

const SETTLE_MS = 300;

/**
 * Can I afford it? One amount, one answer. The server reads the same figure
 * the page shows (Left to spend, Left this week, or one envelope's Left) and
 * answers the state with every number in it; the phone words it. Nothing is
 * written, so there is no Save: when moving money would make it fit, the
 * button opens that envelope's Move.
 */
export function AffordSheet({
	data,
	visible,
	onClose,
	onMove,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	/** Open Move on this envelope (the answer's way to make it fit). */
	onMove: (envelopeId: string) => void;
}) {
	const t = useTranslations("mobile.budget.afford");
	const tp = useTranslations("mobile.budget.pool");
	const { api } = useSession();
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = data.book.currency;
	const style = data.book.style;
	const byEnvelope = style === "EVERY_DOLLAR" || style === "LIMITS";
	const [draft, setDraft] = useState("");
	const [envelopeId, setEnvelopeId] = useState<string | null>(null);
	const [answer, setAnswer] = useState<Answer | null>(null);
	const [failed, setFailed] = useState(false);
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);

	// A closed sheet forgets the last question.
	useEffect(() => {
		if (visible) return;
		setDraft("");
		setEnvelopeId(null);
		setAnswer(null);
	}, [visible]);

	// One read per settled amount, not one per key.
	useEffect(() => {
		setFailed(false);
		if (!visible || !api || minor === null) {
			setAnswer(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			api.budget
				.afford(
					affordQuery({
						month: data.month.key,
						minor,
						currency,
						envelopeId: byEnvelope ? envelopeId : null,
					}),
				)
				.then((out) => {
					if (!cancelled) setAnswer(out);
				})
				.catch(() => {
					if (!cancelled) setFailed(true);
				});
		}, SETTLE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [api, visible, minor, currency, envelopeId, byEnvelope, data.month.key]);

	const choices = useMemo(
		() =>
			envelopesOf(data)
				.filter((e) => e.kind !== "SAVINGS")
				.map((e) => ({ id: e.id, label: e.name, detail: money(e.left) })),
		[data, money],
	);
	const pool = tp(data.toAssign.poolName);
	const a = answer;
	const act = a?.action ?? null;
	const fits =
		a?.state === "FITS" ||
		a?.state === "FITS_TIGHT" ||
		a?.state === "WEEK_FITS";
	const moveTarget =
		act?.kind === "MOVE_MONEY"
			? act.envelopeId
			: act?.kind === "ADD_TO_SPENDING"
				? data.book.defaultEnvelopeId
				: null;

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<AmountField
					currency={currency}
					draft={draft}
					entered={entered}
					label={t("amount")}
					onDraftChange={setDraft}
				/>
				{byEnvelope ? (
					<ChoiceList
						choices={choices}
						label={t("envelope")}
						onPress={(id) => setEnvelopeId(id === envelopeId ? null : id)}
						selected={new Set(envelopeId ? [envelopeId] : [])}
					/>
				) : null}
				{failed ? (
					<Note tone="attention">{t("failed")}</Note>
				) : a ? (
					<>
						<Note>
							{t(`state.${a.state}`, {
								after: money(a.after, { sign: "never" }),
								short: money(a.short),
								left: money(a.left),
								spent: money(a.spent),
								notPlanned: money(a.notPlanned),
								pool,
							})}
						</Note>
						{fits ? (
							<Note>
								{t("perDay", {
									perDay: money(a.perDay),
									days: a.daysLeft,
								})}
							</Note>
						) : null}
						{a.usualPerDay ? (
							<Note>{t("usual", { usual: money(a.usualPerDay) })}</Note>
						) : null}
						{a.incomplete ? <Note>{t("incomplete")}</Note> : null}
						{act && act.kind !== "PLAN_NEXT_MONTH" && moveTarget ? (
							<Button
								label={t(`action.${act.kind}`, { amount: money(act.amount) })}
								onPress={() => onMove(moveTarget)}
								variant="outlined"
							/>
						) : null}
					</>
				) : minor === null ? (
					<Note>{t("idle")}</Note>
				) : (
					<Note>{t("checking")}</Note>
				)}
			</SheetBody>
		</Sheet>
	);
}

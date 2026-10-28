import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
import { minorOf, readAmount } from "./amount";
import { type DraftOutcome, whatIfBody } from "./draftsBody";
import { ChoiceList } from "./fields";
import { AmountField, Line, Note, SheetBody, useAmountLocale } from "./parts";
import { type BudgetMonth, envelopeById, envelopesOf } from "./source";

const SETTLE_MS = 300;

/**
 * What if I spend: a pretend expense on a draft nothing is written for. The
 * draft lives while the sheet is open and is discarded when it closes. The
 * server's outcome says what the envelope would have and, when it would go
 * short, where a cover could come from. Nothing here changes your money, so
 * there is nothing to undo.
 */
export function WhatIfSheet({
	data,
	visible,
	onClose,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.whatIf");
	const tp = useTranslations("mobile.budget.pool");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const { api } = useSession();
	const currency = data.book.currency;
	const [envelopeId, setEnvelopeId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [outcome, setOutcome] = useState<DraftOutcome | null>(null);
	const [failed, setFailed] = useState(false);
	const ids = useRef({ draft: newClientId(), row: newClientId() });
	const saved = useRef(false);
	const minor = minorOf(readAmount(draft, locale, currency));

	useEffect(() => {
		if (!visible) return;
		setEnvelopeId(null);
		setDraft("");
		setOutcome(null);
		setFailed(false);
		saved.current = false;
		ids.current = { draft: newClientId(), row: newClientId() };
	}, [visible]);

	// The pretend expense is saved and read back once the amount settles.
	useEffect(() => {
		const body = whatIfBody({
			id: ids.current.draft,
			rowId: ids.current.row,
			month: data.month.key,
			envelopeId,
			minor,
			currency,
		});
		setOutcome(null);
		setFailed(false);
		if (!visible || !api || !body) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			api.budget
				.saveDraft(body)
				.then(() => {
					saved.current = true;
					return api.budget.draftOutcome({ draftId: body.id });
				})
				.then((out) => {
					if (!cancelled) setOutcome(out);
				})
				.catch(() => {
					if (!cancelled) setFailed(true);
				});
		}, SETTLE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [visible, api, envelopeId, minor, data.month.key, currency]);

	function close() {
		if (saved.current && api) {
			void api.budget
				.discardDraft({ draftId: ids.current.draft })
				.catch(() => undefined);
		}
		onClose();
	}

	const envelope = envelopeById(data, envelopeId);
	const mine = outcome?.envelopes.find((e) => e.envelopeId === envelopeId);
	const short = outcome?.shortfalls.find((s) => s.envelopeId === envelopeId);
	return (
		<Sheet
			detents={["large"]}
			onClose={close}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<Note>{t("lead")}</Note>
				<ChoiceList
					choices={envelopesOf(data).map((e) => ({
						id: e.id,
						label: e.name,
						detail: money(e.left),
					}))}
					label={t("envelope")}
					onPress={setEnvelopeId}
					selected={new Set(envelopeId ? [envelopeId] : [])}
				/>
				<AmountField
					currency={currency}
					draft={draft}
					entered={readAmount(draft, locale, currency)}
					label={t("ifSpend")}
					onDraftChange={setDraft}
				/>
				{failed ? <Note tone="attention">{t("cannot")}</Note> : null}
				{mine && envelope ? (
					<>
						<Line
							emphasis
							label={t("wouldHave", { name: envelope.name })}
							value={money(mine.left.after)}
						/>
						{short?.cover.map((c) => (
							<Line
								key={c.from ?? "pool"}
								label={t("coverFrom", {
									name: c.from
										? (envelopeById(data, c.from)?.name ?? "")
										: tp(data.toAssign.poolName),
								})}
								value={money(c.amount)}
							/>
						))}
						{short && short.uncovered.minor > 0 ? (
							<Line label={t("uncovered")} value={money(short.uncovered)} />
						) : null}
					</>
				) : !failed ? (
					<Note>{t("idle")}</Note>
				) : null}
			</SheetBody>
		</Sheet>
	);
}

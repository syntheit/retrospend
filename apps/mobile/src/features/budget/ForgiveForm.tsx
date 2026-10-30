import { useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { AmountField } from "@/ui/AmountField";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { forgivable, forgiveBody, type OwedPerson } from "./owedBodies";
import { EnvelopePick, PickLabeled } from "./pickers";
import { type BudgetMonth, envelopesOf } from "./source";
import { WriteForm } from "./WriteSheet";

const HOME = "home";

/**
 * Forgive part or all of what one person owes you. The balance falls by it,
 * no money comes back, and the amount is charged to an envelope (Everything
 * else unless you pick). The dry run shows exactly that; the toast takes it
 * back.
 */
export function ForgiveForm({
	data,
	person,
	onDone,
	onClose,
}: {
	data: BudgetMonth;
	person: OwedPerson;
	onDone: () => void;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.forgive");
	const to = useTranslations("mobile.budget.owed");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const lines = forgivable(person);
	const [currency, setCurrency] = useState<string | null>(
		lines[0]?.amount.currency ?? null,
	);
	const [draft, setDraft] = useState("");
	const [envelope, setEnvelope] = useState(HOME);
	const line = lines.find((l) => l.amount.currency === currency) ?? null;
	const entered = currency ? readAmount(draft, locale, currency) : null;
	const minor = entered ? minorOf(entered) : null;
	const name = person.name ?? to("someone");
	const { idFor } = useWriteIds(
		JSON.stringify([currency, minor, envelope, person.participant.id]),
	);
	const body = forgiveBody({
		id: idFor("forgive"),
		person,
		currency,
		minor,
		envelopeId: envelope === HOME ? null : envelope,
	});
	const over = line && minor !== null && minor > line.amount.minor;
	return (
		<WriteForm
			data={data}
			idempotencyKey={body?.id ?? null}
			input={body}
			message={() =>
				t("toast", {
					name,
					amount: currency && minor !== null ? money({ minor, currency }) : "",
				})
			}
			onClose={onClose}
			onDone={onDone}
			preview={(api, b) => api.budget.previewForgive(b)}
			submitLabel={t("forgive")}
			write={(api, b, key) =>
				api.budget.forgive(b, { context: { idempotencyKey: key } })
			}
		>
			{line ? (
				<Note>{t("owes", { name, amount: money(line.amount) })}</Note>
			) : (
				<Note>{t("nothing")}</Note>
			)}
			{lines.length > 1 ? (
				<PickLabeled label={t("currency")}>
					<CurrencyPicker
						currencies={lines.map((l) => l.amount.currency)}
						label={t("currency")}
						onChange={setCurrency}
						value={currency ?? lines[0]?.amount.currency ?? ""}
					/>
				</PickLabeled>
			) : null}
			{currency ? (
				<AmountField
					currency={currency}
					draft={draft}
					entered={entered ?? { state: "empty" }}
					label={t("amount")}
					onDraftChange={setDraft}
				/>
			) : null}
			{over ? <Note tone="attention">{t("tooMuch")}</Note> : null}
			<EnvelopePick
				envelopes={envelopesOf(data).filter(
					(e) => e.id !== data.book.defaultEnvelopeId,
				)}
				extras={[{ id: HOME, name: t("everythingElse") }]}
				label={t("chargeTo")}
				onChange={(id) => setEnvelope(id ?? HOME)}
				value={envelope}
			/>
			<Note>{t("effect", { name })}</Note>
		</WriteForm>
	);
}

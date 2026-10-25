"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { Field } from "~/features/entry/shared-ui";
import { api, type RouterInputs } from "~/trpc/react";
import { minorOf } from "./amount-cell";
import { EnvelopeSelect, type Place } from "./envelope-select";
import { useAmount } from "./use-amount";
import type { EnvelopeInGroup } from "./use-month";
import { newId, useBudgetWrite } from "./use-write";

type CreateRule = RouterInputs["envelope"]["createRule"];
type Kind = "PERCENT" | "AMOUNT" | "REMAINDER";

/**
 * Add a rule (SPEC §5.10): what happens to money that arrives from now on.
 * It moves no money by itself; the rule list is what runs on the next money
 * in. Undo archives the rule again.
 */
export function RuleEditor({
	envelopes,
	currency,
	open,
	onClose,
}: {
	envelopes: readonly EnvelopeInGroup[];
	currency: string;
	open: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("budgetSheets.rules.editor");
	const locale = useLocale();
	const { saved } = useBudgetWrite();
	const utils = api.useUtils();
	const create = api.envelope.createRule.useMutation();
	const archive = api.envelope.archiveRule.useMutation();
	const [name, setName] = useState("");
	const [kind, setKind] = useState<Kind>("PERCENT");
	const [percent, setPercent] = useState("");
	const amount = useAmount(currency);
	const [envelopeId, setEnvelopeId] = useState<string | null>(null);
	const [id] = useState(newId);

	const places = useMemo<Place[]>(
		() =>
			envelopes.map((e) => ({
				value: e.id,
				name: e.name,
				identity: e,
				amount: null,
			})),
		[envelopes],
	);
	// Hundredths of a percent are typed as a plain two-decimal number ("12.5").
	const bp = minorOf(percent, locale, "USD");
	const action: CreateRule["action"] | null =
		kind === "REMAINDER"
			? { kind }
			: kind === "PERCENT"
				? bp && bp > 0 && bp <= 10000
					? { kind, basisPoints: bp }
					: null
				: amount.minor && amount.minor > 0
					? { kind, amountMinor: amount.minor }
					: null;
	const input: CreateRule | null =
		name.trim() && action && envelopeId
			? { id, name, match: { kind: "ANY" }, action, envelopeId }
			: null;

	const onSubmit = async () => {
		if (!input) return false;
		await create.mutateAsync(input);
		await utils.envelope.rules.invalidate();
		saved(t("toast", { name: input.name }), () =>
			archive
				.mutateAsync({ id: input.id })
				.then(() => utils.envelope.rules.invalidate()),
		);
	};
	return (
		<Sheet
			detent="large"
			onOpenChange={(o) => !o && onClose()}
			onSubmit={onSubmit}
			open={open}
			submitDisabled={!input}
			submitLabel={t("add")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4 pb-4">
				<Field label={t("name")}>
					<Input
						aria-label={t("name")}
						maxLength={64}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("namePlaceholder")}
						value={name}
					/>
				</Field>
				<Segmented
					label={t("kind")}
					onChange={setKind}
					options={[
						{ value: "PERCENT", label: t("percent") },
						{ value: "AMOUNT", label: t("amount") },
						{ value: "REMAINDER", label: t("rest") },
					]}
					value={kind}
				/>
				{kind === "PERCENT" ? (
					<Field label={t("percentLabel")}>
						<Input
							aria-label={t("percentLabel")}
							inputMode="decimal"
							onChange={(e) => setPercent(e.target.value)}
							placeholder="20"
							value={percent}
						/>
					</Field>
				) : null}
				{kind === "AMOUNT" ? (
					<Field label={t("amountLabel")}>
						<MoneyInput
							currency={currency}
							onChange={(text) => amount.set(text)}
							value={amount.text}
						/>
					</Field>
				) : null}
				<Field label={t("goesTo")}>
					<EnvelopeSelect
						label={t("goesTo")}
						onChange={setEnvelopeId}
						placeholder={t("pick")}
						places={places}
						value={envelopeId}
					/>
				</Field>
				<p className="text-fg-3 text-small">{t("note")}</p>
			</div>
		</Sheet>
	);
}

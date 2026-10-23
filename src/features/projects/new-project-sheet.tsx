"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { parseMoneyInput } from "@retrospend/domain/parse";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { MoneyInput } from "~/components/money/money-input";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";

/**
 * New project: name, an optional note, the currency with an optional budget
 * (one MoneyInput: its currency chip is the project's currency), and who it
 * is for. "With others" opens the new project on Add person. The save ends
 * with an Undo toast that deletes the project again.
 *
 * Kind, dates and cover from the mockup need fields the project does not
 * have yet (GAPS, "Projects: kind, dates and cover").
 */
export function NewProjectSheet({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectsV2.new");
	const tt = useTranslations("projectsV2.toast");
	const locale = useLocale();
	const router = useRouter();
	const toast = useToast();
	const utils = api.useUtils();
	const settings = api.settings.getGeneral.useQuery();
	const create = api.project.create.useMutation();
	const remove = api.project.delete.useMutation();
	const [name, setName] = useState("");
	const [note, setNote] = useState("");
	const [currency, setCurrency] = useState<string | null>(null);
	const [budget, setBudget] = useState("");
	const [who, setWho] = useState<"solo" | "others">("solo");
	const [tried, setTried] = useState(false);
	const code = currency ?? settings.data?.homeCurrency ?? "USD";
	const parsed = parseMoneyInput(budget, locale, code);
	const budgetBad = budget.trim() !== "" && !parsed.ok;

	const submit = async () => {
		setTried(true);
		if (!name.trim() || budgetBad) return false;
		const project = await create.mutateAsync({
			name: name.trim(),
			description: note.trim() || undefined,
			primaryCurrency: code,
			...(parsed.ok
				? {
						// The API takes major units: the exact decimal text, read as a number.
						budgetAmount: Number(
							fromMinor({ minor: parsed.minor, currency: code }),
						),
						budgetCurrency: code,
					}
				: {}),
		});
		await utils.project.invalidate();
		toast.saved(tt("created", { name: project.name }), {
			undo: async () => {
				await remove.mutateAsync({ id: project.id });
				await utils.project.invalidate();
			},
		});
		if (who === "others") router.push(`/projects/${project.id}?add=person`);
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open
			submitLabel={t("submit")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<Label htmlFor="np-name">{t("name")}</Label>
					<Input
						aria-invalid={tried && !name.trim() ? true : undefined}
						autoFocus
						id="np-name"
						maxLength={191}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("namePlaceholder")}
						value={name}
					/>
					{tried && !name.trim() ? (
						<span className="text-danger text-meta" role="alert">
							{t("nameMissing")}
						</span>
					) : null}
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="np-note">{t("note")}</Label>
					<Textarea
						id="np-note"
						maxLength={500}
						onChange={(e) => setNote(e.target.value)}
						rows={2}
						value={note}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="np-budget">{t("budget")}</Label>
					<MoneyInput
						currency={code}
						id="np-budget"
						onChange={setBudget}
						onCurrencyChange={setCurrency}
						showErrors={tried && budgetBad}
						value={budget}
					/>
					<span className="text-fg-3 text-meta">{t("budgetHint")}</span>
				</div>
				<div className="flex flex-col gap-1">
					<Label>{t("people")}</Label>
					<Segmented
						label={t("people")}
						onChange={setWho}
						options={[
							{ value: "solo", label: t("justMe") },
							{ value: "others", label: t("withOthers") },
						]}
						value={who}
					/>
				</div>
			</div>
		</Sheet>
	);
}

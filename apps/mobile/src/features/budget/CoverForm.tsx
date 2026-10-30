import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { type FormProps, useApi } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { Picker } from "@/ui/Picker";
import { Text } from "@/ui/Text";
import { coverBody } from "./bodies";
import { changesAnything } from "./preview";
import { type CoverOverview, envelopeById } from "./source";
import { WriteForm } from "./WriteSheet";

const POOL = "pool";

/**
 * Cover an overspent envelope from another place. The server says how much it
 * is over by, where the money can come from and where it suggests (never a
 * goal or a bill by default); the person can change both before Cover.
 */
export function CoverForm({
	data,
	envelope,
	month,
	onDone,
	onClose,
}: FormProps) {
	const t = useTranslations("mobile.budget.cover");
	const tb = useTranslations("mobile.budget");
	const format = useFormatter();
	const api = useApi();
	const money = useMoneyText();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const currency = data.book.currency;
	const poolName = tb(`pool.${data.toAssign.poolName}`);
	const [overview, setOverview] = useState<CoverOverview | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [pick, setPick] = useState<string | null>(null);
	const [draft, setDraft] = useState("");

	useEffect(() => {
		if (!api) return;
		let cancelled = false;
		api.budget
			.coverSources({ envelopeId: envelope.id, month })
			.then((result) => {
				if (cancelled) return;
				setOverview(result);
				setPick(result.suggested ? (result.suggested.from ?? POOL) : null);
				setDraft(
					result.need.minor > 0
						? draftFromMinor(result.need.minor, locale, currency)
						: "",
				);
			})
			.catch(() => !cancelled && setLoadFailed(true));
		return () => {
			cancelled = true;
		};
	}, [api, envelope.id, month, locale, currency]);

	const sources = overview?.sources ?? [];
	const nameOf = (from: string | null) =>
		from === null
			? poolName
			: (envelopeById(data, from)?.name ?? t("sourceFallback"));
	const source = sources.find((s) => (s.from ?? POOL) === pick) ?? null;
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const bodyKey =
		minor === null || !source
			? null
			: JSON.stringify({ from: source.from, minor, month, id: envelope.id });
	const { idFor } = useWriteIds(bodyKey);
	const input =
		minor === null || !source
			? null
			: coverBody({
					id: idFor("cover"),
					month,
					envelopeId: envelope.id,
					from: source.from,
					minor,
					currency,
				});

	const optionLabel = (s: CoverOverview["sources"][number]) => {
		const base = t("source", {
			name: nameOf(s.from),
			amount: money(s.available),
		});
		return s.dueDate
			? t("sourceDue", {
					source: base,
					date: format.dateTime(new Date(`${s.dueDate}T12:00:00Z`), {
						month: "short",
						day: "numeric",
						timeZone: "UTC",
					}),
				})
			: base;
	};

	return (
		<WriteForm
			canSave={changesAnything}
			data={data}
			idempotencyKey={input?.id ?? null}
			input={input}
			message={() =>
				t("toast", {
					name: envelope.name,
					amount: money({ minor: minor ?? 0, currency }),
					source: nameOf(source?.from ?? null),
				})
			}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => api.budget.previewCover(body)}
			submitLabel={t("submit")}
			write={(api, body, key) =>
				api.budget.cover(body, { context: { idempotencyKey: key } })
			}
		>
			<AmountField
				currency={currency}
				draft={draft}
				entered={entered}
				label={t("amount")}
				onDraftChange={setDraft}
			/>
			{loadFailed ? (
				<Note tone="attention">{t("loadError")}</Note>
			) : !overview ? (
				<Note>{tb("preview.checking")}</Note>
			) : (
				<>
					<Note>
						{overview.need.minor > 0
							? t("lead", {
									name: envelope.name,
									amount: money(overview.need),
								})
							: t("notOver", { name: envelope.name })}
					</Note>
					{sources.length > 0 ? (
						<View style={{ gap: space[1] }}>
							<Text tone="fg2" variant="small">
								{t("from")}
							</Text>
							<Picker
								onChange={setPick}
								options={[
									...(source ? [] : [{ value: "", label: t("pickSource") }]),
									...sources.map((s) => ({
										value: s.from ?? POOL,
										label: optionLabel(s),
									})),
								]}
								value={source ? (source.from ?? POOL) : ""}
							/>
						</View>
					) : (
						<Note>{t("noSource")}</Note>
					)}
				</>
			)}
		</WriteForm>
	);
}

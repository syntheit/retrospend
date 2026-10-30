import { dayKey } from "@retrospend/domain/time-zone";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useEntryCatalog } from "@/features/entry/hooks";
import { PickField } from "@/features/entry/PickField";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import {
	AmountField,
	SheetBody,
	useAmountLocale,
} from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { noSession, useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { DateField } from "@/ui/DateField";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { ListGroup } from "@/ui/List";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { FieldLabel, TextField } from "@/ui/TextField";
import { useDayText } from "./ConfirmSheet";
import { nextMonthly } from "./makeRecurring";
import { useRecurringToast } from "./useRecurringToast";

type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

type FrequencyKey = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

const FREQUENCIES: { value: Frequency; key: FrequencyKey }[] = [
	{ value: "WEEKLY", key: "weekly" },
	{ value: "BIWEEKLY", key: "biweekly" },
	{ value: "MONTHLY", key: "monthly" },
	{ value: "QUARTERLY", key: "quarterly" },
	{ value: "YEARLY", key: "yearly" },
];

/**
 * Add a recurring expense, as the web does: a name, an amount in a currency,
 * a category, how often, the first due day and auto-pay. A template books
 * nothing until a confirm, so the server's dry run says what is added and
 * that every total stays; Add stays off until it is in. The write carries one
 * key per body, and the toast undoes it by deleting the template (R30, R15).
 * Recurring income is on the web for now.
 */
export function AddRecurringSheet({
	visible,
	onClose,
	onDone,
}: {
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.recurring");
	const tp = useTranslations("mobile.pickers");
	const api = useApi();
	const { state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const catalogState = useEntryCatalog();
	const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
	const announce = useRecurringToast();
	const day = useDayText();
	const locale = useAmountLocale();
	const { color, size, space } = useTheme();
	const fallback = me?.defaultCurrency ?? me?.homeCurrency ?? "USD";

	const [name, setName] = useState("");
	const [currency, setCurrency] = useState(fallback);
	const [draft, setDraft] = useState("");
	const [categoryId, setCategoryId] = useState<string | null>(null);
	const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
	const [first, setFirst] = useState(() => nextMonthly(dayKey(new Date())));
	const [autoPay, setAutoPay] = useState(true);

	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const title = name.trim();
	const input =
		visible && title !== "" && minor !== null
			? {
					name: title,
					amount: wireAmount(minor, currency),
					currency,
					...(categoryId ? { categoryId } : {}),
					frequency,
					nextDueDate: first,
					autoPay,
				}
			: null;
	const { idFor, reset } = useWriteIds(input ? JSON.stringify(input) : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts empty with a fresh write id
	useEffect(() => {
		if (!visible) return;
		setName("");
		setCurrency(fallback);
		setDraft("");
		setCategoryId(null);
		setFrequency("MONTHLY");
		setFirst(nextMonthly(dayKey(new Date())));
		setAutoPay(true);
		reset();
	}, [visible]);

	const flow = useMoneyWrite({
		input,
		idempotencyKey: input ? idFor("write") : null,
		preview: (body) => (api ? api.recurring.previewCreate(body) : noSession()),
		write: (body, key) =>
			api
				? api.recurring.create(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const made = await flow.commit();
		if (!made) return;
		announce({
			message: t("add.toast", { title: made.title }),
			undo: async () => {
				if (!api) throw new Error("Signed out");
				await api.recurring.delete(
					{ id: made.id },
					{ context: { idempotencyKey: newClientId() } },
				);
			},
			onChanged: onDone,
		});
		onClose();
	}

	const categories = catalog?.categories ?? [];
	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("add.title")}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={flow.committing}
					changes={
						<PreviewChanges
							lead={[
								{
									key: "repeats",
									label: t("add.repeats"),
									value: t(`frequency.${frequencyKey(frequency)}`),
								},
								{
									key: "first",
									label: t("add.first"),
									value: day(first),
								},
							]}
							preview={flow.preview}
							status={flow.status}
						/>
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready"}
					submitLabel={t("add.submit")}
				>
					<TextField
						autoCapitalize="sentences"
						label={t("add.name")}
						maxLength={191}
						onChangeText={setName}
						placeholder={t("add.namePlaceholder")}
						value={name}
					/>
					<View style={{ gap: space[2] }}>
						<View
							style={{
								minHeight: size.touchMin.phone,
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
								gap: space[3],
							}}
						>
							<FieldLabel>{t("add.amount")}</FieldLabel>
							<CurrencyPicker
								currencies={catalog?.currencies ?? [currency]}
								onChange={(next) => {
									setCurrency(next);
									setDraft("");
								}}
								recent={catalog?.recentCurrencies ?? []}
								value={currency}
								yours={[me?.homeCurrency, me?.defaultCurrency].filter(
									(c): c is string => Boolean(c),
								)}
							/>
						</View>
						<AmountField
							currency={currency}
							draft={draft}
							entered={entered}
							label={t("add.amount")}
							onDraftChange={setDraft}
						/>
					</View>
					<View style={{ marginHorizontal: -size.gutter.phone }}>
						<ListGroup>
							<PickField
								empty={tp("category.empty")}
								find={tp("category.find")}
								label={t("add.category")}
								none={{
									label: t("add.categoryNone"),
									lead: null,
								}}
								onChange={setCategoryId}
								rows={categories.map((c) => ({
									id: c.id,
									label: c.name,
									lead: (
										<CategoryGlyph
											category={c}
											color={categoryColor(color, c.tone)}
											size={size.icon.phone}
										/>
									),
								}))}
								title={tp("category.title")}
								value={categoryId}
							/>
						</ListGroup>
					</View>
					<View style={{ gap: space[2] }}>
						<FieldLabel>{t("add.repeats")}</FieldLabel>
						<Segmented
							accessibilityLabel={t("add.repeats")}
							onChange={setFrequency}
							options={FREQUENCIES.map((f) => ({
								value: f.value,
								label: t(`frequency.${f.key}`),
							}))}
							stretch
							value={frequency}
						/>
					</View>
					<View style={{ gap: space[1] }}>
						<DateField
							label={t("add.first")}
							onChange={setFirst}
							value={first}
						/>
						<Text tone="fg2" variant="small">
							{t("add.firstHint")}
						</Text>
					</View>
					<SwitchRow
						detail={t(autoPay ? "item.autoOnHint" : "item.autoOffHint")}
						label={t("item.autoPay")}
						onChange={setAutoPay}
						value={autoPay}
					/>
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}

function frequencyKey(f: Frequency): FrequencyKey {
	return FREQUENCIES.find((x) => x.value === f)?.key ?? "monthly";
}

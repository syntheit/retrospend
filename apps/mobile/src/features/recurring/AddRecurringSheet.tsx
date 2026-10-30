import { dayKey } from "@retrospend/domain/time-zone";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useCategories } from "@/features/activity/useCategories";
import { useCurrencyChoices } from "@/features/entry/currencyChoices";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import { SheetBody, useAmountLocale } from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { noSession, useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { Button } from "@/ui/Button";
import { ChipGroup } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { ListGroup } from "@/ui/List";
import { PickField } from "@/ui/PickField";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { FieldError, TextField } from "@/ui/TextField";
import { useDayText } from "./ConfirmSheet";
import { nextMonthly } from "./makeRecurring";
import { useRecurringToast } from "./useRecurringToast";
import { readWebsite } from "./websiteUrl";

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
	const tc = useTranslations("mobile.common");
	const api = useApi();
	const { state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const { state: categoryState } = useCategories();
	const announce = useRecurringToast();
	const day = useDayText();
	const locale = useAmountLocale();
	const { color, size, space } = useTheme();
	const fallback = me?.defaultCurrency ?? me?.homeCurrency ?? "USD";
	const currencies = useCurrencyChoices(fallback);

	const [name, setName] = useState("");
	const [currency, setCurrency] = useState(fallback);
	const [draft, setDraft] = useState("");
	const [categoryId, setCategoryId] = useState<string | null>(null);
	const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
	const [first, setFirst] = useState(() => nextMonthly(dayKey(new Date())));
	const [autoPay, setAutoPay] = useState(false);
	const [more, setMore] = useState(false);
	const [website, setWebsite] = useState("");
	// The keypad comes up when the amount is tapped and gives way to the rest.
	const [keypad, setKeypad] = useState(false);

	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered);
	const title = name.trim();
	const site = readWebsite(website);
	const input =
		visible && title !== "" && minor !== null && site !== "invalid"
			? {
					name: title,
					amount: wireAmount(minor, currency),
					currency,
					...(categoryId ? { categoryId } : {}),
					frequency,
					nextDueDate: first,
					autoPay,
					...(site ? { websiteUrl: site } : {}),
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
		setAutoPay(false);
		setMore(false);
		setWebsite("");
		setKeypad(false);
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

	// An expense template files under expense categories only; a cached list
	// from before kinds were sent is expense categories.
	const categories =
		categoryState.status === "ready"
			? categoryState.data.filter((c) => c.kind !== "income")
			: [];
	return (
		<Sheet
			detents={["large"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						disabled={flow.status !== "ready" || flow.committing}
						label={flow.committing ? tc("saving") : t("add.submit")}
						onPress={() => void submit()}
					/>
				</>
			}
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
						onTypingChange={(typing) => typing && setKeypad(false)}
						placeholder={t("add.namePlaceholder")}
						value={name}
					/>
					<AmountField
						choose={{
							...currencies,
							onChange: (next) => {
								setCurrency(next);
								setDraft("");
							},
						}}
						currency={currency}
						draft={draft}
						entered={entered}
						keypad={keypad}
						label={t("add.amount")}
						onDraftChange={setDraft}
						onPress={() => setKeypad(true)}
					/>
					{/* The sheet body is already inset; the group adds its own gutter. */}
					<View style={{ marginHorizontal: -size.gutter.phone }}>
						<ListGroup form>
							<PickField
								empty={tp("category.empty")}
								find={tp("category.find")}
								label={t("add.category")}
								none={{
									label: t("add.categoryNone"),
									lead: null,
								}}
								onChange={(next) => {
									setCategoryId(next);
									setKeypad(false);
								}}
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
					<ChipGroup
						accessibilityLabel={t("add.repeats")}
						label={t("add.repeats")}
						onChange={(next) => {
							setFrequency(next);
							setKeypad(false);
						}}
						options={FREQUENCIES.map((f) => ({
							value: f.value,
							label: t(`frequency.${f.key}`),
						}))}
						value={frequency}
					/>
					<View style={{ gap: space[1] }}>
						<DateField
							label={t("add.first")}
							onChange={(next) => {
								setFirst(next);
								setKeypad(false);
							}}
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
					{more ? (
						<View style={{ gap: space[1] }}>
							<TextField
								invalid={site === "invalid"}
								keyboardType="url"
								label={t("add.website")}
								maxLength={512}
								onChangeText={setWebsite}
								onTypingChange={(typing) => typing && setKeypad(false)}
								placeholder={t("add.websitePlaceholder")}
								value={website}
							/>
							{site === "invalid" ? (
								<FieldError>{t("add.websiteInvalid")}</FieldError>
							) : null}
						</View>
					) : (
						<View style={{ alignItems: "flex-start" }}>
							<TextAction
								label={tc("moreDetails")}
								onPress={() => {
									setMore(true);
									setKeypad(false);
								}}
							/>
						</View>
					)}
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}

function frequencyKey(f: Frequency): FrequencyKey {
	return FREQUENCIES.find((x) => x.value === f)?.key ?? "monthly";
}

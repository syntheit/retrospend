import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { newClientId } from "@/data/ids";
import { minorOf, readAmount } from "@/features/budget/amount";
import {
	AmountField,
	Note,
	SheetBody,
	useAmountLocale,
} from "@/features/budget/parts";
import { useMoneyWrite, useWriteIds } from "@/features/budget/useMoneyWrite";
import { useUndoToast } from "@/features/budget/useUndoToast";
import { noSession, useApi, WriteFrame } from "@/features/budget/WriteFrame";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { Picker } from "@/ui/Picker";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { TextField } from "@/ui/TextField";
import {
	ACCOUNT_TYPES,
	type AccountForm,
	aprInvalid,
	type CreateAccountBody,
	createBody,
	dueDayInvalid,
	emptyForm,
	formOf,
	type UpdateAccountBody,
	updateBody,
} from "./accountBody";
import { isLiability } from "./accounts";
import type { Account, CurrencyInfo } from "./source";

/** USD is the rate table's base; any other foreign currency needs a stored rate. */
export function isRated(
	currency: string,
	home: string,
	catalog: readonly CurrencyInfo[],
): boolean {
	if (currency === home || currency === "USD") return true;
	return (catalog.find((c) => c.code === currency)?.rateTypes.length ?? 0) > 0;
}

/**
 * Add account / Edit account: name, type, currency and balance (on a new
 * account), the rate type when the currency has several, liability terms and
 * Liquid. The dry run shows what net worth would do before Save is on; the
 * toast undoes it. An existing account's balance changes with Update balance,
 * not here.
 */
export function AccountSheet({
	account,
	visible,
	home,
	catalog,
	onClose,
	onDone,
}: {
	/** Null adds a new account. */
	account: Account | null;
	visible: boolean;
	home: string;
	catalog: readonly CurrencyInfo[];
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.wealth.account");
	const tw = useTranslations("mobile.wealth");
	const api = useApi();
	const announce = useUndoToast("accounts");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const { color, space, type } = useTheme();
	const editing = account !== null;
	const [form, setForm] = useState<AccountForm>(emptyForm(home));
	const [draft, setDraft] = useState("");
	const [minimumDraft, setMinimumDraft] = useState("");
	const accountId = useRef(newClientId());

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the account (or empty) with a fresh id
	useEffect(() => {
		if (!visible) return;
		accountId.current = account ? account.id : newClientId();
		setForm(account ? formOf(account) : emptyForm(home));
		setDraft("");
		setMinimumDraft(
			account?.minimumPayment
				? draftFromMinor(
						account.minimumPayment.minor,
						locale,
						account.minimumPayment.currency,
					)
				: "",
		);
		reset();
	}, [visible]);

	const entered = readAmount(draft, locale, form.currency);
	const typedMinor = minorOf(entered, true);
	const minimum = readAmount(minimumDraft, locale, form.currency);
	const current: AccountForm = {
		...form,
		minor: editing ? form.minor : typedMinor,
		minimumMinor: minimumDraft.trim() === "" ? null : minorOf(minimum),
	};
	const debt = isLiability(form.type);
	const rated = isRated(form.currency, home, catalog);
	const rateTypes = useMemo(
		() =>
			form.currency === home
				? []
				: (catalog.find((c) => c.code === form.currency)?.rateTypes ?? []),
		[catalog, form.currency, home],
	);
	const body = rated
		? editing
			? updateBody(current, accountId.current)
			: createBody(current, accountId.current)
		: null;
	const bodyKey = body ? JSON.stringify(body) : null;
	const { idFor, reset } = useWriteIds(bodyKey);

	const flow = useMoneyWrite({
		input: visible ? body : null,
		idempotencyKey: body ? idFor("write") : null,
		preview: (b) =>
			api
				? editing
					? api.accounts.previewUpdate(b as UpdateAccountBody)
					: api.accounts.previewCreate(b as CreateAccountBody)
				: noSession(),
		write: (b, key) =>
			api
				? editing
					? api.accounts.update(b as UpdateAccountBody, {
							context: { idempotencyKey: key },
						})
					: api.accounts.create(b as CreateAccountBody, {
							context: { idempotencyKey: key },
						})
				: noSession(),
	});

	const set = (patch: Partial<AccountForm>) =>
		setForm((previous) => ({ ...previous, ...patch }));

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t(editing ? "savedToast" : "addedToast", {
				name: form.name.trim(),
			}),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const lead =
		!editing && typedMinor !== null
			? [
					{
						key: "new",
						label: form.name.trim() || t("name"),
						value: money({ minor: typedMinor, currency: form.currency }),
					},
				]
			: [];
	const small = { color: color.fg2, fontSize: type.small.size } as const;

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={editing ? t("editTitle") : t("addTitle")}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={flow.committing}
					changes={
						rated ? (
							<PreviewChanges
								lead={lead}
								preview={flow.preview}
								status={flow.status}
							/>
						) : (
							<Note tone="attention">
								{t("noRate", { currency: form.currency })}
							</Note>
						)
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready"}
					submitLabel={editing ? t("save") : t("add")}
				>
					<TextField
						autoCapitalize="sentences"
						invalid={form.name !== "" && form.name.trim() === ""}
						label={t("name")}
						onChangeText={(name) => set({ name })}
						placeholder={t("namePlaceholder")}
						value={form.name}
					/>
					<View style={{ gap: space[2] }}>
						<Text style={small}>{t("type")}</Text>
						<Picker
							onChange={(next) => set({ type: next as AccountForm["type"] })}
							options={ACCOUNT_TYPES.map((value) => ({
								value,
								label: tw(`types.${value}`),
							}))}
							value={form.type}
						/>
					</View>
					{editing ? (
						<Note>
							{t("balanceFixed", {
								amount: money({
									minor: form.minor ?? 0,
									currency: form.currency,
								}),
							})}
						</Note>
					) : (
						<View style={{ gap: space[2] }}>
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									justifyContent: "space-between",
								}}
							>
								<Text style={small}>{debt ? t("owed") : t("balance")}</Text>
								<CurrencyPicker
									currencies={catalog.map((c) => c.code)}
									onChange={(code) => set({ currency: code, rateType: null })}
									recent={[]}
									value={form.currency}
									yours={[home]}
								/>
							</View>
							<AmountField
								allowZero
								currency={form.currency}
								draft={draft}
								entered={entered}
								label={debt ? t("owed") : t("balance")}
								onDraftChange={setDraft}
							/>
						</View>
					)}
					{rateTypes.length > 1 ? (
						<View style={{ gap: space[2] }}>
							<Text style={small}>{t("rateType")}</Text>
							<Picker
								onChange={(next) => set({ rateType: next })}
								options={rateTypes.map((value) => ({ value, label: value }))}
								value={form.rateType ?? rateTypes[0] ?? ""}
							/>
						</View>
					) : null}
					{debt ? (
						<View style={{ gap: space[4] }}>
							<TextField
								invalid={aprInvalid(form.apr)}
								keyboardType="decimal-pad"
								label={t("apr")}
								onChangeText={(apr) => set({ apr })}
								value={form.apr}
							/>
							<TextField
								invalid={dueDayInvalid(form.dueDay)}
								keyboardType="number-pad"
								label={t("dueDay")}
								onChangeText={(dueDay) => set({ dueDay })}
								value={form.dueDay}
							/>
							<TextField
								invalid={minimum.state === "invalid"}
								keyboardType="decimal-pad"
								label={t("minimum")}
								onChangeText={setMinimumDraft}
								value={minimumDraft}
							/>
						</View>
					) : (
						<SwitchRow
							detail={t("liquidHint")}
							label={t("liquid")}
							onChange={(liquid) => set({ liquid })}
							value={form.liquid}
						/>
					)}
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}

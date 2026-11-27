import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { newClientId } from "@/data/ids";
import { useSheetRead } from "@/features/budget/useSheetRead";
import { useCurrencyChoices } from "@/features/entry/currencyChoices";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useOfflineDryRun } from "@/features/recurring/useSettle";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, SheetBody, useAmountLocale } from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { noSession, useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { AmountField, FixedCurrency } from "@/ui/AmountField";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { Picker, WheelField } from "@/ui/Picker";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { FieldLabel, TextField } from "@/ui/TextField";
import {
	ACCOUNT_TYPES,
	type AccountForm,
	aprInvalid,
	createBody,
	dueDayOptions,
	emptyForm,
	formOf,
	updateBody,
} from "./accountBody";
import { previewAccountForm, writeAccountForm } from "./accountDeviceWrites";
import { isLiability } from "./accounts";
import { RateTypeChips } from "./RateTypeChips";
import { rateTypesOf } from "./rateType";
import type { Account, CurrencyInfo } from "./source";
import {
	useOpenedAccount,
	useWealthDevice,
	useWealthEnd,
} from "./useWealthDevice";

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
 *
 * Under the dev flag, when the server takes Wealth writes from the phone, Save
 * is booked on the device and queued instead: offline it waits in the outbox
 * (an edit starts from the screen's own copy when the fresh read cannot be
 * had, and is checked against its version and balance at send), and Undo
 * takes it out of the outbox or through the server once sent. The server's
 * dry run is still what the sheet shows. With either missing it writes online
 * as ever.
 */
export function AccountSheet({
	account: listed,
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
	const tOffline = useTranslations("mobile.composer.changes");
	const tw = useTranslations("mobile.wealth");
	const api = useApi();
	const device = useWealthDevice(visible);
	const { offline, track } = useOfflineDryRun();
	const end = useWealthEnd("accounts");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const editing = listed !== null;
	const choices = useCurrencyChoices(home);
	const [form, setForm] = useState<AccountForm>(emptyForm(home));
	const [draft, setDraft] = useState("");
	const [minimumDraft, setMinimumDraft] = useState("");
	// Two amounts can be typed here; the keypad sits under the one in hand.
	const [typing, setTyping] = useState<"balance" | "minimum">("balance");
	const active = editing ? "minimum" : typing;
	const accountId = useRef(newClientId());
	// The account on the list can be older than the book: an edit also writes a
	// balance checkpoint from its form, so the form starts from a fresh read and
	// Save stays off until that read is in.
	const read = useSheetRead(
		visible && editing,
		(client) => client.accounts.get({ id: listed?.id ?? "" }),
		listed?.id ?? "",
	);
	// Offline with the device, the screen's own copy stands in for the read: the
	// write is checked against its version and balance at send.
	const source: Account | null =
		read.status === "ready"
			? read.data
			: device && read.status === "error"
				? listed
				: null;
	const { shown, opened } = useOpenedAccount(device, source, visible);
	const loaded = !editing || shown !== null;
	const base = shown
		? `${shown.id}:${shown.version}:${shown.balance.minor}`
		: "";

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the account (or empty) with a fresh id; `base` says the account moved
	useEffect(() => {
		if (!visible || !loaded) return;
		accountId.current = shown ? shown.id : newClientId();
		setForm(shown ? formOf(shown) : emptyForm(home));
		setDraft("");
		setMinimumDraft(
			shown?.minimumPayment
				? draftFromMinor(
						shown.minimumPayment.minor,
						locale,
						shown.minimumPayment.currency,
					)
				: "",
		);
		reset();
	}, [visible, base]);

	const entered = readAmount(draft, locale, form.currency);
	const typedMinor = minorOf(entered, true);
	const minimum = readAmount(minimumDraft, locale, form.currency);
	const current: AccountForm = {
		...form,
		minor: editing ? form.minor : typedMinor,
		minimumMinor: minimumDraft.trim() === "" ? null : minorOf(minimum),
		minimumInvalid: minimum.state === "invalid",
	};
	const debt = isLiability(form.type);
	const rated = isRated(form.currency, home, catalog);
	const rateTypes = useMemo(
		() => rateTypesOf(catalog, form.currency, home),
		[catalog, form.currency, home],
	);
	const body =
		rated && loaded
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
				? previewAccountForm({ api, device, editing, body: b, track })
				: noSession(),
		write: (b, key) =>
			api
				? writeAccountForm({
						api,
						device,
						editing,
						body: b,
						key,
						opened,
						name: form.name.trim(),
					})
				: noSession(),
	});

	const set = (patch: Partial<AccountForm>) =>
		setForm((previous) => ({ ...previous, ...patch }));

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		end(out, {
			device,
			title: form.name.trim(),
			message: t(editing ? "savedToast" : "addedToast", {
				name: form.name.trim(),
			}),
			onChanged: onDone,
		});
		onClose();
	}

	const offlineNote =
		device && offline && flow.status === "failed"
			? tOffline("offline")
			: undefined;
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
								message={offlineNote}
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
					ready={flow.status === "ready" || offlineNote !== undefined}
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
					<View style={{ flexDirection: "row", gap: space[4] }}>
						<View style={{ flex: 1, gap: space[1] }}>
							<FieldLabel>{t("type")}</FieldLabel>
							<Picker
								onChange={(next) => set({ type: next as AccountForm["type"] })}
								options={ACCOUNT_TYPES.map((value) => ({
									value,
									label: tw(`types.${value}`),
								}))}
								value={form.type}
							/>
						</View>
						<View style={{ flex: 1, gap: space[1] }}>
							<FieldLabel>{t("currency")}</FieldLabel>
							{editing ? (
								<FixedCurrency code={form.currency} />
							) : (
								<View style={{ alignItems: "flex-start" }}>
									<CurrencyPicker
										currencies={catalog.map((c) => c.code)}
										onChange={(code) => set({ currency: code, rateType: null })}
										recent={choices.recent}
										value={form.currency}
										yours={choices.yours}
									/>
								</View>
							)}
						</View>
					</View>
					{editing && read.status === "error" && !device ? (
						<Note tone="attention">{t("loadError")}</Note>
					) : null}
					{editing ? (
						loaded ? (
							<Note>
								{t("balanceFixed", {
									amount: money({
										minor: form.minor ?? 0,
										currency: form.currency,
									}),
								})}
							</Note>
						) : null
					) : (
						<AmountField
							allowZero
							currency={form.currency}
							draft={draft}
							entered={entered}
							keypad={active === "balance"}
							label={debt ? t("owed") : t("balance")}
							onDraftChange={setDraft}
							onPress={() => setTyping("balance")}
						/>
					)}
					<RateTypeChips
						onChange={(next) => set({ rateType: next })}
						types={rateTypes}
						value={form.rateType ?? rateTypes[0] ?? null}
					/>
					{debt ? (
						<View style={{ gap: space[4] }}>
							<TextField
								invalid={aprInvalid(form.apr)}
								keyboardType="decimal-pad"
								label={t("apr")}
								onChangeText={(apr) => set({ apr })}
								value={form.apr}
							/>
							<View style={{ gap: space[1] }}>
								<FieldLabel>{t("dueDay")}</FieldLabel>
								<View style={{ alignItems: "flex-start" }}>
									<WheelField
										label={t("dueDay")}
										onChange={(dueDay) => set({ dueDay })}
										options={dueDayOptions(form.dueDay, t("dueDayNone"))}
										value={form.dueDay}
										variant="chip"
									/>
								</View>
							</View>
							<AmountField
								allowZero
								currency={form.currency}
								draft={minimumDraft}
								entered={minimum}
								keypad={active === "minimum"}
								label={t("minimum")}
								onDraftChange={setMinimumDraft}
								onPress={() => setTyping("minimum")}
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

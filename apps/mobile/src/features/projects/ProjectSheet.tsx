import { draftFromMinor } from "@retrospend/domain/parse";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { newClientId } from "@/data/ids";
import { useCurrencyChoices } from "@/features/entry/currencyChoices";
import { announceEntryChange } from "@/features/entry/events";
import { Note, SheetBody, useAmountLocale } from "@/features/write/parts";
import { useApi, WriteFrame } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { FieldLabel, TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import {
	budgetCurrencyOf,
	budgetInvalid,
	createBody,
	emptyForm,
	NAME_MAX,
	NOTE_MAX,
	type ProjectForm,
	type ProjectOriginal,
	readBudget,
	updateBody,
} from "./projectForm";

/**
 * New project / Edit project: a name, an optional note, the project's currency,
 * an optional budget and, for a new project, who it is for (Just me, or With
 * others, which opens the project on Add person). It moves no money, so it has
 * no preview, and a new project is not taken back with Undo (deleting one is
 * its own, careful action). Edit sends only what changed. The footer has
 * Cancel and the primary action.
 *
 * The mockup also has Kind, Dates and Cover. The database and API v1 have no
 * kind, no project dates and no cover choice (a project's image is an upload
 * the API does not take), so those wait for a schema change. Everything else
 * about a project (people, billing periods) is set on its page.
 */
export function ProjectSheet({
	project,
	visible,
	home,
	onClose,
	onDone,
	onCreated,
}: {
	/** Null starts a new project. */
	project: ProjectOriginal | null;
	visible: boolean;
	/** The currency a new project starts in. */
	home: string;
	onClose: () => void;
	/** The project was saved: the screen behind refreshes. */
	onDone?: () => void;
	/** A new project was made; `others` when it was chosen to open on Add person. */
	onCreated?: (made: { id: string; name: string }, others: boolean) => void;
}) {
	const t = useTranslations("mobile.projects.form");
	const tc = useTranslations("mobile.common");
	const api = useApi();
	const toast = useToast();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const editing = project !== null;
	const choices = useCurrencyChoices(project?.primaryCurrency ?? home);
	const [form, setForm] = useState<ProjectForm>(emptyForm(home));
	const [keypad, setKeypad] = useState(false);
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	// One id per opening: sending it twice is a conflict, not a second project.
	const projectId = useRef(newClientId());
	const writeKey = useRef(newClientId());

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the project (or empty) with a fresh id
	useEffect(() => {
		if (!visible) return;
		projectId.current = newClientId();
		writeKey.current = newClientId();
		setKeypad(false);
		setFailed(false);
		setForm(
			project
				? {
						name: project.name,
						currency: project.primaryCurrency,
						note: project.description ?? "",
						who: "solo" as const,
						budget: project.budget
							? draftFromMinor(
									project.budget.amount.minor,
									locale,
									project.budget.amount.currency,
								)
							: "",
					}
				: emptyForm(home),
		);
	}, [visible]);

	const set = (patch: Partial<ProjectForm>) => {
		setFailed(false);
		writeKey.current = newClientId();
		setForm((previous) => ({ ...previous, ...patch }));
	};
	const update = project ? updateBody(form, project, locale) : null;
	const create = project ? null : createBody(form, projectId.current, locale);
	const bad = budgetInvalid(form, project, locale);
	const currency = budgetCurrencyOf(form, project);
	const entered = readBudget(form, project, locale);

	async function submit() {
		if (!api || saving) return;
		const options = { context: { idempotencyKey: writeKey.current } };
		const request = update
			? () => api.projects.update(update, options)
			: create
				? () => api.projects.create(create, options)
				: null;
		if (!request) return;
		setSaving(true);
		setFailed(false);
		try {
			const saved = await request();
			announceEntryChange();
			onDone?.();
			toast.show({
				message: t(editing ? "saved" : "created", { name: saved.name }),
			});
			onClose();
			if (!editing) onCreated?.(saved, form.who === "others");
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet
			detents={["large"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						busy={saving}
						disabled={(update === null && create === null) || saving}
						label={saving ? tc("saving") : editing ? t("save") : t("create")}
						onPress={() => void submit()}
					/>
				</>
			}
			onClose={onClose}
			title={editing ? t("editTitle") : t("newTitle")}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={saving}
					changes={null}
					failed={failed}
					onSubmit={submit}
					ready={update !== null || create !== null}
					submitLabel={editing ? t("save") : t("create")}
				>
					<TextField
						autoCapitalize="words"
						invalid={form.name !== "" && form.name.trim() === ""}
						label={t("name")}
						maxLength={NAME_MAX}
						onChangeText={(name) => set({ name })}
						placeholder={t("namePlaceholder")}
						value={form.name}
					/>
					<TextField
						autoCapitalize="sentences"
						label={t("note")}
						maxLength={NOTE_MAX}
						multiline
						onChangeText={(note) => set({ note })}
						value={form.note}
					/>
					<View style={{ gap: space[1] }}>
						<FieldLabel>{t("currency")}</FieldLabel>
						<View style={{ alignItems: "flex-start" }}>
							<CurrencyPicker
								currencies={choices.currencies}
								label={t("currency")}
								onChange={(code) => set({ currency: code })}
								recent={choices.recent}
								value={form.currency}
								yours={choices.yours}
							/>
						</View>
					</View>
					<AmountField
						currency={currency}
						draft={form.budget}
						entered={entered}
						keypad={keypad}
						label={t("budget")}
						onDraftChange={(budget) => set({ budget })}
						onPress={() => setKeypad(true)}
					/>
					{bad ? <Note tone="attention">{t("budgetInvalid")}</Note> : null}
					{editing ? null : (
						<View style={{ gap: space[1] }}>
							<FieldLabel>{t("people")}</FieldLabel>
							<Segmented
								accessibilityLabel={t("people")}
								onChange={(who) => set({ who })}
								options={[
									{ value: "solo", label: t("justMe") },
									{ value: "others", label: t("withOthers") },
								]}
								stretch
								value={form.who}
							/>
						</View>
					)}
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}

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
import { Sheet } from "@/ui/Sheet";
import { FieldLabel, TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import {
	budgetCurrencyOf,
	budgetInvalid,
	createBody,
	emptyForm,
	NAME_MAX,
	type ProjectForm,
	type ProjectOriginal,
	readBudget,
	updateBody,
} from "./projectForm";

/**
 * New project / Edit project: a name, the project's currency and an optional
 * budget. It moves no money, so it has no preview, and a new project is not
 * taken back with Undo (deleting one is its own, careful action). Edit sends
 * only what changed. Everything else about a project (people, dates, billing
 * periods) is set on its page.
 */
export function ProjectSheet({
	project,
	visible,
	home,
	onClose,
	onDone,
}: {
	/** Null starts a new project. */
	project: ProjectOriginal | null;
	visible: boolean;
	/** The currency a new project starts in. */
	home: string;
	onClose: () => void;
	/** The project was saved: the screen behind refreshes. */
	onDone?: () => void;
}) {
	const t = useTranslations("mobile.projects.form");
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
		} catch {
			setFailed(true);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Sheet
			detents={["large"]}
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
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}

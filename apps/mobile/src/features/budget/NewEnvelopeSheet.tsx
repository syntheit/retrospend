import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Note } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { SheetDetent } from "@/ui/Sheet";
import { CategoryList, loadCategories } from "./CategoryList";
import { ChoiceList, TextField } from "./fields";
import { createEnvelopeBody, nameOk } from "./moreBodies";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";
import { FormSheet, WriteForm } from "./WriteSheet";

/** The groups an envelope can sit in, as choices; "none" is the ungrouped list. */
export function groupChoices(data: BudgetMonth, none: string) {
	return [
		...data.groups
			.filter((g) => g.id !== null)
			.map((g) => ({ id: g.id as string, label: g.name ?? "" })),
		{ id: "none", label: none },
	];
}

/**
 * Add an envelope: a name and a group. It starts with no target and no
 * categories (those are one tap away in its own sheet). The dry run shows
 * what the new envelope changes; the toast undoes it.
 */
export function NewEnvelopeSheet({
	data,
	visible,
	detent = "large",
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.newEnvelope");
	const [name, setName] = useState("");
	const [group, setGroup] = useState("none");
	const [picked, setPicked] = useState<string[]>([]);
	const categories = useSheetRead(visible, loadCategories);
	const { idFor, reset } = useWriteIds(
		visible ? `${name}|${group}|${picked.join(",")}` : null,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new opening starts empty
	useEffect(() => {
		if (!visible) return;
		reset();
		setName("");
		setGroup("none");
		setPicked([]);
	}, [visible]);

	const ready = nameOk(name);
	const input = ready
		? createEnvelopeBody({
				id: idFor("envelope"),
				name,
				groupId: group === "none" ? null : group,
				categoryIds: picked,
			})
		: null;
	return (
		<FormSheet
			detent={detent}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<WriteForm
				active={visible}
				data={data}
				idempotencyKey={input?.id ?? null}
				input={input}
				message={() => t("toast", { name: name.trim() })}
				onClose={onClose}
				onDone={onDone}
				preview={(api, body) => api.budget.previewCreateEnvelope(body)}
				submitLabel={t("submit")}
				write={(api, body, key) =>
					api.budget.createEnvelope(body, { context: { idempotencyKey: key } })
				}
			>
				<TextField
					autoCapitalize="sentences"
					label={t("name")}
					maxLength={64}
					onChangeText={setName}
					value={name}
				/>
				<ChoiceList
					choices={groupChoices(data, t("noGroup"))}
					label={t("group")}
					onPress={setGroup}
					selected={new Set([group])}
				/>
				<Note>{t("categoriesHint")}</Note>
				{categories.status === "ready" ? (
					<CategoryList
						categories={categories.data}
						label={t("categories")}
						onPress={(id) =>
							setPicked((now) =>
								now.includes(id) ? now.filter((x) => x !== id) : [...now, id],
							)
						}
						selected={new Set(picked)}
					/>
				) : null}
			</WriteForm>
		</FormSheet>
	);
}

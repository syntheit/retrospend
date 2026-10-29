import { useState } from "react";
import { useTranslations } from "use-intl";
import { Note } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { FormProps } from "@/features/write/WriteFrame";
import { CategoryList, loadCategories } from "./CategoryList";
import { ChoiceList, TextField } from "./fields";
import { updateEnvelopeBody } from "./moreBodies";
import { groupChoices } from "./NewEnvelopeSheet";
import { useSheetRead } from "./useSheetRead";
import { WriteForm } from "./WriteSheet";

/**
 * Rename an envelope or move it to another group. Only what changed is sent;
 * the dry run lists every envelope the edit touches, and the toast undoes it.
 */
export function EditForm({ data, envelope, onDone, onClose }: FormProps) {
	const t = useTranslations("mobile.budget.editEnvelope");
	const [name, setName] = useState(envelope.name);
	const [group, setGroup] = useState(envelope.groupId ?? "none");
	const groupId = group === "none" ? null : group;
	const was = envelope.categoryIds;
	const [picked, setPicked] = useState<string[]>([...was]);
	const categories = useSheetRead(true, loadCategories);
	const body = updateEnvelopeBody({
		id: "-",
		envelopeId: envelope.id,
		name,
		groupId,
		// Categories are sent once the list is in; before that they are not touched.
		categoryIds: categories.status === "ready" ? picked : undefined,
		was: { name: envelope.name, groupId: envelope.groupId, categoryIds: was },
	});
	const { idFor } = useWriteIds(
		body ? `${envelope.id}|${name}|${group}|${picked.join(",")}` : null,
	);
	const input = body ? { ...body, id: idFor("edit") } : null;

	return (
		<WriteForm
			data={data}
			idempotencyKey={input?.id ?? null}
			input={input}
			message={() => t("toast", { name: name.trim() || envelope.name })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, b) => api.budget.previewUpdateEnvelope(b)}
			submitLabel={t("submit")}
			write={(api, b, key) =>
				api.budget.updateEnvelope(b, { context: { idempotencyKey: key } })
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
	);
}

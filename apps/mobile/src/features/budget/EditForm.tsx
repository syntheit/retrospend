import { useState } from "react";
import { useTranslations } from "use-intl";
import { BudgetChanges } from "./BudgetChanges";
import { ChoiceList, TextField } from "./fields";
import { updateEnvelopeBody } from "./moreBodies";
import { groupChoices } from "./NewEnvelopeSheet";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { type FormProps, noSession, useApi, WriteFrame } from "./WriteFrame";

/**
 * Rename an envelope or move it to another group. Only what changed is sent;
 * the dry run lists every envelope the edit touches, and the toast undoes it.
 */
export function EditForm({ data, envelope, onDone, onClose }: FormProps) {
	const t = useTranslations("mobile.budget.editEnvelope");
	const api = useApi();
	const announce = useUndoToast("budget");
	const [name, setName] = useState(envelope.name);
	const [group, setGroup] = useState(envelope.groupId ?? "none");
	const groupId = group === "none" ? null : group;
	const body = updateEnvelopeBody({
		id: "-",
		envelopeId: envelope.id,
		name,
		groupId,
		was: { name: envelope.name, groupId: envelope.groupId },
	});
	const { idFor } = useWriteIds(
		body ? `${envelope.id}|${name}|${group}` : null,
	);
	const input = body ? { ...body, id: idFor("edit") } : null;

	const flow = useMoneyWrite({
		input,
		idempotencyKey: input?.id ?? null,
		preview: (b) => (api ? api.budget.previewUpdateEnvelope(b) : noSession()),
		write: (b, key) =>
			api
				? api.budget.updateEnvelope(b, { context: { idempotencyKey: key } })
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", { name: name.trim() || envelope.name }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<WriteFrame
			busy={flow.committing}
			changes={
				<BudgetChanges
					data={data}
					preview={flow.preview}
					status={flow.status}
				/>
			}
			failed={flow.commitFailed}
			onSubmit={submit}
			ready={flow.status === "ready"}
			submitLabel={t("submit")}
		>
			<TextField
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
		</WriteFrame>
	);
}

import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Sheet } from "@/ui/Sheet";
import { BudgetChanges } from "./BudgetChanges";
import { ChoiceList, TextField } from "./fields";
import { createEnvelopeBody, nameOk } from "./moreBodies";
import { SheetBody } from "./parts";
import type { BudgetMonth } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

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
	onClose,
	onDone,
}: {
	data: BudgetMonth;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.budget.newEnvelope");
	const api = useApi();
	const announce = useUndoToast("budget");
	const [name, setName] = useState("");
	const [group, setGroup] = useState("none");
	const { idFor, reset } = useWriteIds(visible ? `${name}|${group}` : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new opening starts empty
	useEffect(() => {
		if (!visible) return;
		reset();
		setName("");
		setGroup("none");
	}, [visible]);

	const ready = nameOk(name);
	const input = ready
		? createEnvelopeBody({
				id: idFor("envelope"),
				name,
				groupId: group === "none" ? null : group,
			})
		: null;
	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: input?.id ?? null,
		preview: (body) =>
			api ? api.budget.previewCreateEnvelope(body) : noSession(),
		write: (body, key) =>
			api
				? api.budget.createEnvelope(body, {
						context: { idempotencyKey: key },
					})
				: noSession(),
	});

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", { name: name.trim() }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
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
			</SheetBody>
		</Sheet>
	);
}

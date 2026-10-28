import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
import { BudgetChanges } from "./BudgetChanges";
import { ChoiceList, TextField } from "./fields";
import { mergeBody } from "./moreBodies";
import { Note, SheetBody } from "./parts";
import { type BudgetMonth, envelopesOf } from "./source";
import { useMoneyWrite, useWriteIds } from "./useMoneyWrite";
import { useUndoToast } from "./useUndoToast";
import { noSession, useApi, WriteFrame } from "./WriteFrame";

/**
 * Combine envelopes: pick the one that stays, then the ones that go into it.
 * Their money, categories, rules and targets move to the one that stays; the
 * dry run lists every envelope and figure it touches, and the toast undoes it.
 */
export function MergeSheet({
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
	const t = useTranslations("mobile.budget.merge");
	const api = useApi();
	const announce = useUndoToast("budget");
	const money = useMoneyText();
	const [stays, setStays] = useState<string | null>(null);
	const [from, setFrom] = useState<ReadonlySet<string>>(new Set());
	const [name, setName] = useState("");
	const all = envelopesOf(data);
	const stayer = all.find((e) => e.id === stays) ?? null;
	const key = `${stays}|${[...from].sort().join(",")}|${name}`;
	const { idFor, reset } = useWriteIds(visible ? key : null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new opening starts empty
	useEffect(() => {
		if (!visible) return;
		reset();
		setStays(null);
		setFrom(new Set());
		setName("");
	}, [visible]);

	const body = mergeBody({
		id: idFor("merge"),
		intoId: stays,
		fromIds: [...from],
		name,
		was: stayer?.name ?? null,
	});
	const flow = useMoneyWrite({
		input: visible ? body : null,
		idempotencyKey: body?.id ?? null,
		preview: (b) => (api ? api.budget.previewMergeEnvelopes(b) : noSession()),
		write: (b, key2) =>
			api
				? api.budget.mergeEnvelopes(b, { context: { idempotencyKey: key2 } })
				: noSession(),
	});

	function pickStayer(id: string) {
		setStays(id);
		setFrom((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	}
	function toggle(id: string) {
		setFrom((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	}

	async function submit() {
		const out = await flow.commit();
		if (!out || !body) return;
		announce({
			message: t("toast", {
				count: body.fromIds.length,
				name: stayer?.name ?? "",
			}),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	const choices = all.map((e) => ({
		id: e.id,
		label: e.name,
		detail: money(e.left),
	}));
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
					<Note>{t("lead")}</Note>
					<ChoiceList
						choices={choices}
						label={t("stays")}
						onPress={pickStayer}
						selected={new Set(stays ? [stays] : [])}
					/>
					{stays ? (
						<>
							<ChoiceList
								choices={choices.filter((c) => c.id !== stays)}
								label={t("from")}
								onPress={toggle}
								selected={from}
							/>
							<TextField
								label={t("name")}
								maxLength={64}
								onChangeText={setName}
								value={name || stayer?.name || ""}
							/>
						</>
					) : null}
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}

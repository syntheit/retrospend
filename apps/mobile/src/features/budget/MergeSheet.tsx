import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import type { SheetDetent } from "@/ui/Sheet";
import { ChoiceList, TextField } from "./fields";
import { mergeBody } from "./moreBodies";
import { type BudgetMonth, envelopesOf } from "./source";
import { FormSheet, WriteForm } from "./WriteSheet";

/**
 * Combine envelopes: pick the one that stays, then the ones that go into it.
 * Their money, categories, rules and targets move to the one that stays; the
 * dry run lists every envelope and figure it touches, and the toast undoes it.
 */
export function MergeSheet({
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
	const t = useTranslations("mobile.budget.merge");
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

	const choices = all.map((e) => ({
		id: e.id,
		label: e.name,
		detail: money(e.left),
	}));
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
				idempotencyKey={body?.id ?? null}
				input={body}
				message={() =>
					t("toast", {
						count: body?.fromIds.length ?? 0,
						name: stayer?.name ?? "",
					})
				}
				onClose={onClose}
				onDone={onDone}
				preview={(api, b) => api.budget.previewMergeEnvelopes(b)}
				submitLabel={t("submit")}
				write={(api, b, key) =>
					api.budget.mergeEnvelopes(b, { context: { idempotencyKey: key } })
				}
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
							autoCapitalize="sentences"
							label={t("name")}
							maxLength={64}
							onChangeText={setName}
							value={name || stayer?.name || ""}
						/>
					</>
				) : null}
			</WriteForm>
		</FormSheet>
	);
}

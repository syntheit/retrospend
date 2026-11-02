import { categoryTone } from "@retrospend/domain/category-tone";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Line, Note, SheetBody, useAmountLocale } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Hero } from "@/ui/Hero";
import { CategoryTile, ListGroup, ListRow, SectionHeader } from "@/ui/List";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import {
	linesOf,
	linesWith,
	planBase,
	planBody,
	plannedFor,
} from "./draftsBody";
import { monthDate } from "./months";
import { type BudgetMonth, envelopeById } from "./source";
import { useGroupName } from "./useGroupName";
import { useSheetRead } from "./useSheetRead";
import { useTargetText } from "./useTargetText";
import { BackButton } from "./WriteSheet";

/**
 * Plan a coming month: what each envelope should get when its money arrives.
 * A plan is a draft until payday, so saving one line moves no money and the
 * month itself does not change; Undo puts the previous plan back.
 */
export function PlanSheet({
	data,
	visible,
	detent = "large",
	onClose,
}: {
	data: BudgetMonth;
	visible: boolean;
	/** How tall it rests; the registry sets it (sheetRegistry.tsx). */
	detent?: SheetDetent;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.budget.planEdit");
	const tw = useTranslations("mobile.budget.write");
	const tc = useTranslations("mobile.common");
	const money = useMoneyText();
	const format = useFormatter();
	const targetText = useTargetText();
	const groupName = useGroupName();
	const { api } = useSession();
	const toast = useToast();
	const locale = useAmountLocale();
	const month = data.month.key;
	const currency = data.book.currency;
	const [editing, setEditing] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const fallbackId = useRef(newClientId());
	const read = useSheetRead(
		visible,
		(client) => client.budget.drafts({ kind: "PLAN", month }),
		String(month),
	);
	const drafts = read.status === "ready" ? read.data : null;
	const base = planBase(drafts);
	// What is left to plan is the server's figure for the draft, read again
	// whenever the plan is saved.
	const outcome = useSheetRead(
		visible && base !== null,
		(client) => client.budget.draftOutcome({ draftId: base?.id ?? "" }),
		`${base?.id}:${base?.updatedAt}`,
	);
	const left = outcome.status === "ready" ? outcome.data.toAssign.after : null;
	// What the plan gives out and what it expects in: sums of the draft's own
	// lines, shown through the money formatter.
	const planTotal = {
		minor: (base?.lines ?? []).reduce((sum, l) => sum + l.amount.minor, 0),
		currency,
	};
	const expected = {
		minor: (base?.expectedIn ?? []).reduce((sum, l) => sum + l.amount.minor, 0),
		currency,
	};
	const monthName = format.dateTime(monthDate(month), {
		month: "long",
		timeZone: "UTC",
	});
	const envelope = envelopeById(data, editing);
	const entered = readAmount(draft, locale, currency);
	const minor = minorOf(entered, true);

	useEffect(() => {
		if (!visible) return;
		setEditing(null);
		setDraft("");
		setFailed(false);
		fallbackId.current = newClientId();
	}, [visible]);

	async function save() {
		// The plan is saved whole, so it starts only from a plan read for this
		// month: a save from nothing would replace the open plan with one line.
		if (!api || !drafts || !envelope || minor === null || busy) return;
		const id = drafts?.open?.id ?? fallbackId.current;
		const before = linesOf(base);
		setBusy(true);
		setFailed(false);
		try {
			await api.budget.saveDraft(
				planBody({
					id,
					month,
					lines: linesWith(base, envelope.id, minor, currency),
					base,
				}),
				{ context: { idempotencyKey: newClientId() } },
			);
		} catch {
			setFailed(true);
			setBusy(false);
			// The plan may have changed elsewhere: read it again before a retry.
			read.reload();
			return;
		}
		setBusy(false);
		read.reload();
		toast.show({
			message: t("toast", { name: envelope.name }),
			undo: {
				label: tc("undo"),
				onUndo: async () => {
					try {
						await api.budget.saveDraft(
							planBody({ id, month, lines: before, base }),
							{ context: { idempotencyKey: newClientId() } },
						);
						toast.show({ message: tw("undone") });
						read.reload();
					} catch {
						toast.show({ message: tw("undoError") });
					}
				},
			},
		});
		setEditing(null);
		setDraft("");
	}

	const planned = envelope ? plannedFor(base, envelope.id) : null;
	const { space } = useTheme();
	return (
		<Sheet
			detents={[detent]}
			onClose={onClose}
			title={envelope ? t("title", { name: envelope.name }) : t("listTitle")}
			visible={visible}
		>
			<SheetBody>
				{envelope ? (
					<>
						<BackButton
							label={tc("back")}
							onPress={() => {
								setEditing(null);
								setDraft("");
							}}
						/>
						<Note>{t("lead")}</Note>
						<Line
							label={t("planned")}
							value={planned ? money(planned) : t("notPlanned")}
						/>
						{envelope.target && envelope.target.need.minor > 0 ? (
							<Note>
								{t("target", { amount: money(envelope.target.need) })}
							</Note>
						) : null}
						<AmountField
							allowZero
							currency={currency}
							draft={draft}
							entered={entered}
							label={t("planned")}
							onDraftChange={setDraft}
						/>
						{failed ? <Note tone="attention">{tw("error")}</Note> : null}
						{read.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
						) : null}
						<Button
							busy={busy}
							disabled={!drafts || minor === null || busy}
							label={busy ? tc("saving") : t("save")}
							onPress={() => void save()}
						/>
					</>
				) : (
					<>
						{left ? (
							<View style={{ paddingHorizontal: space[4] }}>
								<Hero
									label={t("leftToPlan", { month: monthName })}
									sub={
										base && expected.minor > 0
											? t("plannedOf", {
													planned: money(planTotal),
													expected: money(expected),
												})
											: undefined
									}
									tone={left.minor < 0 ? "attention" : "fg"}
									value={money(left, { sign: "never" })}
								/>
							</View>
						) : null}
						{read.status === "error" ? (
							<View style={{ paddingHorizontal: space[4] }}>
								<Note tone="attention">{t("error")}</Note>
							</View>
						) : null}
						{data.groups.map((group) => (
							<View key={group.id ?? "none"}>
								<SectionHeader
									title={groupName(group)}
									total={money({
										minor: group.envelopes.reduce(
											(sum, e) => sum + (plannedFor(base, e.id)?.minor ?? 0),
											0,
										),
										currency,
									})}
								/>
								<ListGroup>
									{group.envelopes.map((e) => {
										const p = plannedFor(base, e.id) ?? { minor: 0, currency };
										const target = targetText(e, false);
										return (
											<ListRow
												end={
													<Chip
														accessibilityLabel={`${e.name}, ${money(p)}`}
														label={money(p)}
														onPress={() => setEditing(e.id)}
													/>
												}
												key={e.id}
												lead={
													<CategoryTile
														category={{
															name: e.name,
															icon: e.icon,
															tone: categoryTone(e.color ?? ""),
														}}
													/>
												}
												sub={
													target ? (
														<Text
															numberOfLines={1}
															tone={target.attention ? "attention" : "fg3"}
															variant="meta"
														>
															{target.text}
														</Text>
													) : undefined
												}
												title={e.name}
											/>
										);
									})}
								</ListGroup>
							</View>
						))}
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}

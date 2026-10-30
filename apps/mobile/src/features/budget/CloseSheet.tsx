import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { MoneyAmount } from "@/ui/Money";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note, SheetBody } from "@/features/write/parts";
import { useWriteIds } from "@/features/write/useMoneyWrite";
import { Button } from "@/ui/Button";
import { ListRow, SectionHeader } from "@/ui/List";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import { acknowledgeBody, carryable, carryBody } from "./closeBodies";
import { nextMonthKey } from "./draftsBody";
import { monthDate } from "./months";
import { type BudgetMonth, envelopeById } from "./source";
import { useSheetRead } from "./useSheetRead";
import { BackButton, WriteForm } from "./WriteSheet";

/**
 * A closed month's summary, read-only, from the server's stored close: money
 * in, what was assigned, what went over, what each leftover rule did. Done
 * marks that revision as read. An overspend can be taken from the envelope's
 * own next month instead: its own previewed, undoable step.
 * The server says what was already carried, so a row offers only the rest;
 * the summary is read again after a carry and after its Undo.
 */
export function CloseSheet({
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
	const t = useTranslations("mobile.budget.close");
	const tc = useTranslations("mobile.budget.carry");
	const tw = useTranslations("mobile.budget.write");
	const tp = useTranslations("mobile.budget.pool");
	const money = useMoneyText();
	const format = useFormatter();
	const { api } = useSession();
	const month = data.month.key;
	const [carrying, setCarrying] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const read = useSheetRead(
		visible,
		(client) => client.budget.monthSummary({ month }),
		String(month),
	);
	const summary = read.status === "ready" ? read.data : null;
	const sum = summary?.summary ?? null;
	const name = (key: number) =>
		format.dateTime(monthDate(key), { month: "long", timeZone: "UTC" });
	const nextName = name(nextMonthKey(month));
	const envelopeName = (id: string) =>
		envelopeById(data, id)?.name ?? t("envelopeFallback");
	const cash = (minor: number) => ({ minor, currency: sum?.currency ?? "" });
	const over = carryable(summary);
	const left = (sum?.envelopes ?? []).filter(
		(e) => e.returned > 0 || e.swept > 0,
	);
	const carry = over.find((e) => e.id === carrying) ?? null;
	const { idFor } = useWriteIds(visible && carry ? carry.id : null);
	const body = carry
		? carryBody({
				id: idFor("carry"),
				envelopeId: carry.id,
				minor: carry.minor,
				currency: sum?.currency ?? "",
			})
		: null;
	// After the carry and after its Undo: what was carried changed.
	const carryDone = () => {
		read.reload();
		onDone();
	};

	useEffect(() => {
		if (!visible) return;
		setCarrying(null);
		setFailed(false);
	}, [visible]);

	async function done() {
		const ack = summary ? acknowledgeBody(month, summary) : null;
		if (ack && api) {
			try {
				await api.budget.acknowledgeMonth(ack, {
					context: { idempotencyKey: newClientId() },
				});
				onDone();
			} catch {
				setFailed(true);
				return;
			}
		}
		onClose();
	}

	// An open month has nothing to read but one line, so it rests at medium.
	const unclosed = read.status === "ready" && !sum;
	return (
		<Sheet
			detents={[unclosed ? "medium" : detent]}
			onClose={onClose}
			title={
				sum
					? t("title", { month: name(month) })
					: t("titleOpen", { month: name(month) })
			}
			visible={visible}
		>
			<SheetBody>
				{carry ? (
					<>
						<BackButton label={t("back")} onPress={() => setCarrying(null)} />
						<WriteForm
							data={data}
							idempotencyKey={body?.id ?? null}
							input={body}
							message={() =>
								tc("toast", {
									name: envelopeName(carry.id),
									month: nextName,
								})
							}
							onClose={() => setCarrying(null)}
							onDone={carryDone}
							preview={(client, b) => client.budget.previewCarryOverspend(b)}
							submitLabel={tc("take", { name: envelopeName(carry.id) })}
							write={(client, b, key) =>
								client.budget.carryOverspend(b, {
									context: { idempotencyKey: key },
								})
							}
						>
							<Note>
								{tc("lead", { name: envelopeName(carry.id), month: nextName })}
							</Note>
						</WriteForm>
					</>
				) : (
					<>
						{read.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
						) : null}
						{read.status === "ready" && !sum ? (
							<Note>{t("notClosed")}</Note>
						) : null}
						{sum ? (
							<>
								<View>
									<ListRow
										accessibilityLabel={`${t("moneyIn")}, ${money(cash(sum.moneyIn))}`}
										end={<MoneyAmount value={cash(sum.moneyIn)} />}
										sub={t("moneyInSub", { month: name(month) })}
										title={t("moneyIn")}
									/>
									<ListRow
										accessibilityLabel={`${t("assigned")}, ${money(cash(sum.assigned))}`}
										end={<MoneyAmount value={cash(sum.assigned)} />}
										sub={t("assignedSub")}
										title={t("assigned")}
									/>
								</View>
								{summary?.lateEntries ? (
									<Note>{t("late", { count: summary.lateEntries })}</Note>
								) : null}
								{over.length > 0 ? (
									<View>
										<SectionHeader title={t("overTitle")} />
										{over.map((e) => (
											<ListRow
												accessibilityLabel={t("takeInstead", {
													month: nextName,
												})}
												end={<MoneyAmount value={cash(e.minor)} />}
												key={e.id}
												onPress={() => setCarrying(e.id)}
												sub={t("takeInstead", { month: nextName })}
												title={envelopeName(e.id)}
											/>
										))}
									</View>
								) : null}
								{left.length > 0 ? (
									<View>
										<SectionHeader title={t("leftTitle")} />
										{left.map((e) => (
											<ListRow
												end={
													<MoneyAmount
														value={cash(e.returned > 0 ? e.returned : e.swept)}
													/>
												}
												key={e.id}
												sub={
													e.returned > 0
														? t("returned", {
																pool: tp(data.toAssign.poolName),
															})
														: t("swept", {
																name: e.sweepToId
																	? envelopeName(e.sweepToId)
																	: "",
															})
												}
												title={envelopeName(e.id)}
											/>
										))}
									</View>
								) : null}
								{failed ? <Note tone="attention">{tw("error")}</Note> : null}
								<Button label={t("done")} onPress={() => void done()} />
							</>
						) : null}
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}

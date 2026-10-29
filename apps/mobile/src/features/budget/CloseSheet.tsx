import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { LinkButton, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { acknowledgeBody, carryBody } from "./closeBodies";
import { nextMonthKey } from "./draftsBody";
import { monthDate } from "./months";
import { Line, Note, SheetBody } from "./parts";
import { type BudgetMonth, envelopeById } from "./source";
import { useWriteIds } from "./useMoneyWrite";
import { useSheetRead } from "./useSheetRead";
import { WriteForm } from "./WriteSheet";

/**
 * A closed month's summary, read-only, from the server's stored close: money
 * in, what was assigned, what went over, what each leftover rule did. Done
 * marks that revision as read. An overspend can be taken from the envelope's
 * own next month instead: its own previewed, undoable step.
 *
 * The stored close does not change when an overspend is carried (the carry
 * is a step in this month), so the sheet itself drops a carried row and puts
 * it back when that carry is undone.
 */
export function CloseSheet({
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
	const t = useTranslations("mobile.budget.close");
	const tc = useTranslations("mobile.budget.carry");
	const tw = useTranslations("mobile.budget.write");
	const tp = useTranslations("mobile.budget.pool");
	const money = useMoneyText();
	const format = useFormatter();
	const { api } = useSession();
	const { color, space, type } = useTheme();
	const month = data.month.key;
	const [carrying, setCarrying] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [carried, setCarried] = useState<ReadonlySet<string>>(new Set());
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
	const over = (sum?.envelopes ?? []).filter(
		(e) => e.overspent > 0 && !carried.has(e.id),
	);
	const left = (sum?.envelopes ?? []).filter(
		(e) => e.returned > 0 || e.swept > 0,
	);
	const carry = over.find((e) => e.id === carrying) ?? null;
	const { idFor } = useWriteIds(visible && carry ? carry.id : null);
	const body = carry
		? carryBody({
				id: idFor("carry"),
				envelopeId: carry.id,
				minor: carry.overspent,
				currency: sum?.currency ?? "",
			})
		: null;
	// The toast runs `onDone` once for the carry and once more for its Undo.
	const carryId = carry?.id ?? null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: one counter per carry; `onDone` is the screen's reload
	const carryDone = useMemo(() => {
		let calls = 0;
		return () => {
			calls += 1;
			const undone = calls % 2 === 0;
			if (carryId)
				setCarried((previous) => {
					const next = new Set(previous);
					if (undone) next.delete(carryId);
					else next.add(carryId);
					return next;
				});
			onDone();
		};
	}, [carryId]);

	useEffect(() => {
		if (!visible) return;
		setCarrying(null);
		setFailed(false);
		setCarried(new Set());
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

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title", { month: name(month) })}
			visible={visible}
		>
			<SheetBody>
				{carry ? (
					<>
						<View style={{ alignItems: "flex-start", marginLeft: -space[4] }}>
							<LinkButton label={t("back")} onPress={() => setCarrying(null)} />
						</View>
						<WriteForm
							data={data}
							idempotencyKey={body?.id ?? null}
							input={body}
							message={tc("toast", {
								name: envelopeName(carry.id),
								month: nextName,
							})}
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
									<Line label={t("moneyIn")} value={money(cash(sum.moneyIn))} />
									<Line
										label={t("assigned")}
										value={money(cash(sum.assigned))}
									/>
								</View>
								{summary?.lateEntries ? (
									<Note>{t("late", { count: summary.lateEntries })}</Note>
								) : null}
								{over.length > 0 ? (
									<View>
										<Text
											accessibilityRole="header"
											style={{
												color: color.fg2,
												fontSize: type.small.size,
												fontWeight: "600",
											}}
										>
											{t("overTitle")}
										</Text>
										{over.map((e) => (
											<ListRow
												accessibilityLabel={t("takeInstead", {
													month: nextName,
												})}
												key={e.id}
												onPress={() => setCarrying(e.id)}
											>
												<View style={{ flex: 1 }}>
													<Text
														style={{
															color: color.fg,
															fontSize: type.body.size,
														}}
													>
														{envelopeName(e.id)}
													</Text>
													<Text
														style={{
															color: color.brand,
															fontSize: type.small.size,
														}}
													>
														{t("takeInstead", { month: nextName })}
													</Text>
												</View>
												<Text
													style={{
														color: color.fg,
														fontSize: type.body.size,
														fontVariant: ["tabular-nums"],
													}}
												>
													{money(cash(e.overspent), { sign: "never" })}
												</Text>
											</ListRow>
										))}
									</View>
								) : null}
								{left.length > 0 ? (
									<View>
										<Text
											accessibilityRole="header"
											style={{
												color: color.fg2,
												fontSize: type.small.size,
												fontWeight: "600",
											}}
										>
											{t("leftTitle")}
										</Text>
										{left.map((e) => (
											<Line
												key={e.id}
												label={`${envelopeName(e.id)}, ${
													e.returned > 0
														? t("returned", {
																pool: tp(data.toAssign.poolName),
															})
														: t("swept", {
																name: e.sweepToId
																	? envelopeName(e.sweepToId)
																	: "",
															})
												}`}
												value={money(
													cash(e.returned > 0 ? e.returned : e.swept),
												)}
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

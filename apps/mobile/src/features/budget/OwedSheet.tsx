import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { Face } from "@/features/entry/Face";
import { LinkButton, ListRow } from "@/features/read/parts";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Sheet } from "@/ui/Sheet";
import { ForgiveForm } from "./ForgiveForm";
import { forgivable, participantKey } from "./owedBodies";
import { Line, Note, SheetBody } from "./parts";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";

/**
 * Money held for others: who owes you and how much, oldest first as the
 * server lists them. A person who owes you opens Forgive; settling up is on
 * the People tab. Every figure is the server's.
 */
export function OwedSheet({
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
	const t = useTranslations("mobile.budget.owed");
	const money = useMoneyText();
	const { color, size, space, type } = useTheme();
	const [forgiving, setForgiving] = useState<string | null>(null);
	const read = useSheetRead(visible, (client) => client.budget.owed());
	const owed = read.status === "ready" ? read.data : null;
	const person =
		owed?.people.find((p) => participantKey(p.participant) === forgiving) ??
		null;

	useEffect(() => {
		if (visible) setForgiving(null);
	}, [visible]);

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={
				person
					? t("forgiveTitle", { name: person.name ?? t("someone") })
					: t("title")
			}
			visible={visible}
		>
			<SheetBody>
				{person ? (
					<>
						<View style={{ alignItems: "flex-start", marginLeft: -space[4] }}>
							<LinkButton
								label={t("back")}
								onPress={() => setForgiving(null)}
							/>
						</View>
						<ForgiveForm
							data={data}
							onClose={() => {
								setForgiving(null);
								onClose();
							}}
							onDone={() => {
								read.reload();
								onDone();
							}}
							person={person}
						/>
					</>
				) : (
					<>
						{read.status === "error" ? (
							<Note tone="attention">{t("error")}</Note>
						) : null}
						{owed && owed.people.length === 0 ? (
							<Note>{t("nobody")}</Note>
						) : null}
						{owed ? (
							<>
								<Line emphasis label={t("held")} value={money(owed.held)} />
								{owed.pending.minor !== 0 ? (
									<Note>{t("pending", { amount: money(owed.pending) })}</Note>
								) : null}
								<View>
									{owed.people.map((p) => {
										const key = participantKey(p.participant);
										const name = p.name ?? t("someone");
										const can = forgivable(p).length > 0;
										return (
											<ListRow
												accessibilityLabel={`${name}, ${p.lines.map((l) => money(l.amount)).join(", ")}`}
												key={key}
												onPress={can ? () => setForgiving(key) : undefined}
											>
												<Face
													diameter={size.icon.phone + space[2]}
													name={name}
													seed={key}
												/>
												<View style={{ flex: 1 }}>
													<Text
														style={{
															color: color.fg,
															fontSize: type.body.size,
														}}
													>
														{name}
													</Text>
													{p.ageDays !== null ? (
														<Text
															style={{
																color: color.fg2,
																fontSize: type.small.size,
															}}
														>
															{t("age", { days: p.ageDays })}
														</Text>
													) : null}
												</View>
												<Text
													style={{
														color: color.fg,
														fontSize: type.body.size,
														fontVariant: ["tabular-nums"],
														textAlign: "right",
													}}
												>
													{p.lines.map((l) => money(l.amount)).join(", ")}
												</Text>
											</ListRow>
										);
									})}
								</View>
								{owed.incomplete ? <Note>{t("incomplete")}</Note> : null}
							</>
						) : null}
					</>
				)}
			</SheetBody>
		</Sheet>
	);
}

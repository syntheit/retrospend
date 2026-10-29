import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Line, Note, SheetBody } from "@/features/write/parts";
import { Avatar } from "@/ui/Avatar";
import { ListRow } from "@/ui/List";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { ForgiveForm } from "./ForgiveForm";
import { forgivable, participantKey } from "./owedBodies";
import type { BudgetMonth } from "./source";
import { useSheetRead } from "./useSheetRead";
import { BackButton } from "./WriteSheet";

/**
 * Money held for others: who owes you and how much, oldest first as the
 * server lists them. A person who owes you opens Forgive; settling up is on
 * the People tab. Every figure is the server's.
 */
export function OwedSheet({
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
	const t = useTranslations("mobile.budget.owed");
	const money = useMoneyText();
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
			detents={[detent]}
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
						<BackButton label={t("back")} onPress={() => setForgiving(null)} />
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
												end={
													<Text tabular tone="positive">
														{p.lines.map((l) => money(l.amount)).join(", ")}
													</Text>
												}
												key={key}
												lead={<Avatar face={{ key, name }} />}
												onPress={can ? () => setForgiving(key) : undefined}
												sub={
													p.ageDays !== null
														? t("age", { days: p.ageDays })
														: undefined
												}
												title={name}
											/>
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

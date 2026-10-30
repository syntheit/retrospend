import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Line, SheetBody } from "@/features/write/parts";
import { heroCents } from "@/ui/Money";
import { Sheet } from "@/ui/Sheet";
import { type Change, movedParts } from "./changeParts";

/**
 * Why net worth moved: the server's parts, which add up to the total to the
 * minor unit, each signed. It opens from the change under the hero, so the
 * page itself shows one number and one link, not a second section.
 */
export function NetWorthChangeSheet({
	change,
	visible,
	onClose,
}: {
	change: Change;
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.wealth");
	const money = useMoneyText();
	const cents = heroCents(change.total.currency);
	const signed = { sign: "exceptZero", cents } as const;
	return (
		<Sheet
			detents={["medium", "large"]}
			onClose={onClose}
			title={t("whyTitle", { days: change.days })}
			visible={visible}
		>
			<SheetBody>
				<View>
					{movedParts(change).map((part) => (
						<Line
							key={part}
							label={t(`parts.${part}`)}
							value={money(change.parts[part], signed)}
						/>
					))}
					<Line
						emphasis
						label={t("changeTotal")}
						value={money(change.total, signed)}
					/>
				</View>
			</SheetBody>
		</Sheet>
	);
}

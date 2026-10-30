import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMyFace } from "@/features/account/AccountTopBar";
import type { PersonIdentity, SettleContext } from "@/features/people/source";
import { useFaces } from "@/features/read/faces";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Avatar } from "@/ui/Avatar";
import { Glyph } from "@/ui/Glyph";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { type Direction, everythingConverts, owedBreakdown } from "./plan";

/**
 * Who pays whom: both faces with an arrow from the payer to the payee, the
 * direction switch under them, and what is owed in words ("You owe Martín
 * ≈ ARS 172,281 · ARS 56,700 + BRL 426.50"): Everything first, then the
 * open balances as the server sends them, never added by the phone.
 */
export function SettleHead({
	person,
	context,
	direction,
	onDirection,
}: {
	person: PersonIdentity;
	context: SettleContext;
	direction: Direction;
	onDirection: (direction: Direction) => void;
}) {
	const t = useTranslations("mobile.settle");
	const tm = useTranslations("mobile.money");
	const money = useMoneyText();
	const faces = useFaces();
	const me = useMyFace();
	const { color, size, space } = useTheme();
	const first = person.name.split(/\s+/)[0] ?? person.name;
	const [them] = faces([
		{ key: person.key, name: person.name, imageUrl: person.imageUrl },
	]);
	const outgoing = direction === "outgoing";
	const payer = outgoing ? me : them;
	const payee = outgoing ? them : me;
	const arrow = (
		<Glyph color={color.fg3} name="ArrowRight" size={size.icon.phone} />
	);

	const everything = context.everything;
	let owe: string | null = null;
	if (everything) {
		const total = everythingConverts(context, direction)
			? tm("approx", { amount: money(everything) })
			: money(everything);
		const lead = outgoing
			? t("youOwe", { name: first, amount: total })
			: t("owesYou", { name: first, amount: total });
		const parts = owedBreakdown(context, direction).map((line) => money(line));
		owe = parts.length > 0 ? `${lead} · ${parts.join(" + ")}` : lead;
	}

	return (
		<View style={{ gap: space[3] }}>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
			>
				{payer ? <Avatar face={payer} size="md" /> : null}
				{arrow}
				{payee ? <Avatar face={payee} size="md" /> : null}
			</View>
			<Segmented
				accessibilityLabel={t("direction")}
				onChange={(value) => onDirection(value)}
				options={[
					{ value: "outgoing", label: t("iPaid", { name: first }) },
					{ value: "incoming", label: t("theyPaid", { name: first }) },
				]}
				stretch
				value={direction}
			/>
			{owe ? <Text tone="fg2">{owe}</Text> : null}
		</View>
	);
}

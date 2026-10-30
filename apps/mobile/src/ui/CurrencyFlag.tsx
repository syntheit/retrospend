import { getCountryCodeFromCurrency } from "@retrospend/domain/currency-country";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useTheme } from "@/theme";
import { FLAGS } from "./flags.generated";
import { Glyph } from "./Glyph";

/**
 * A currency's identity: the flag of its country in a circle; crypto and
 * unknown codes get a coin. Picker rows and the Currencies list show it in
 * the 24 point lead slot, a chip at the 16 point icon size (`small`).
 */
export function CurrencyFlag({
	code,
	small,
}: {
	code: string;
	small?: boolean;
}) {
	const { color, size } = useTheme();
	const country = getCountryCodeFromCurrency(code);
	const xml = country ? FLAGS[country] : undefined;
	const side = small ? size.icon.phone : size.avatar.sm;
	return xml ? (
		<SvgXml height={side} width={side} xml={xml} />
	) : (
		<View
			style={{
				width: side,
				height: side,
				borderRadius: side / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: small ? undefined : color.raised,
			}}
		>
			<Glyph color={color.fg2} name="Coins" size={size.icon.phone} />
		</View>
	);
}

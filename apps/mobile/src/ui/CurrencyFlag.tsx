import { getCountryCodeFromCurrency } from "@retrospend/domain/currency-country";
import { memo } from "react";
import { View } from "react-native";
import { type JsxAST, parse, SvgAst } from "react-native-svg";
import { useTheme } from "@/theme";
import { FLAGS } from "./flags.generated";
import { Glyph } from "./Glyph";

// A flag's drawing is parsed once per country for the whole run. Rendering
// the XML parsed it again for every row, every time the picker's list
// rendered rows (about 20 at first paint, more as it scrolls).
const parsed = new Map<string, JsxAST | null>();

function flagAst(country: string): JsxAST | null {
	let ast = parsed.get(country);
	if (ast === undefined) {
		const xml = FLAGS[country];
		ast = xml ? parse(xml) : null;
		parsed.set(country, ast);
	}
	return ast;
}

/**
 * A currency's identity: the flag of its country in a circle; crypto and
 * unknown codes get a coin. Picker rows and the Currencies list show it in
 * the 24 point lead slot, a chip at the 16 point icon size (`small`).
 */
export const CurrencyFlag = memo(function CurrencyFlag({
	code,
	small,
}: {
	code: string;
	small?: boolean;
}) {
	const { color, size } = useTheme();
	const country = getCountryCodeFromCurrency(code);
	const ast = country ? flagAst(country) : null;
	const side = small ? size.icon.phone : size.avatar.sm;
	return ast ? (
		<SvgAst ast={ast} override={{ height: side, width: side }} />
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
});

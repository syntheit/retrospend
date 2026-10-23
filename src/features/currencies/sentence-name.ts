/**
 * Unit nouns in English currency names. CLDR and our own table title-case
 * them ("Brazilian Real"); sentence case keeps place names and adjectives
 * ("South Korean won", "Hong Kong dollar"), so only the unit is lowered.
 */
const UNITS = new Set(
	(
		"afghani ariary baht balboa birr bolivar boliviano cedi colon convertible " +
		"cordoba dalasi denar dinar dirham dobra dollar dong dram escudo florin " +
		"forint franc gourde guarani guilder hryvnia kina kip koruna krona krone " +
		"kwacha kwanza kyat lari lek lempira leone leu lev lilangeni lira loti " +
		"manat mark metical naira nakfa ngultrum ouguiya pa'anga pataca peso pound " +
		"pula quetzal rand real rial riel riyal ringgit ruble rufiyaa rupee rupiah " +
		"shekel sheqel shilling sol som somoni sterling taka tala tenge tugrik vatu " +
		"won yen yuan zloty"
	).split(" "),
);

/**
 * A currency name in sentence case for a label: the first letter up in
 * every locale ("real brasileño" reads "Real brasileño"), and in English
 * the unit noun down ("US Dollar" reads "US dollar").
 */
export function sentenceName(name: string, locale: string): string {
	const words = locale.toLowerCase().startsWith("en")
		? name
				.split(" ")
				.map((w, i) =>
					i > 0 && UNITS.has(w.toLowerCase()) ? w.toLowerCase() : w,
				)
				.join(" ")
		: name;
	return words.charAt(0).toLocaleUpperCase(locale) + words.slice(1);
}

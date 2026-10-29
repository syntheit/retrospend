import { useTranslations } from "use-intl";

/**
 * A rate type's name as people read it ("Blue", "MEP"), from the catalog; a
 * type the catalog does not know yet shows its key with a capital first.
 */
export function useRateTypeName() {
	const t = useTranslations("mobile.money.rateTypes");
	return (type: string | null | undefined): string => {
		if (!type) return "";
		// The server names the types; the catalog may not know a new one yet.
		const key = type as Parameters<typeof t>[0];
		return t.has(key) ? t(key) : type.charAt(0).toUpperCase() + type.slice(1);
	};
}

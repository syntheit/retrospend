import { useTranslations } from "use-intl";

type ListWords = (
	key: "two" | "many" | "separator",
	values?: Record<string, string>,
) => string;

/** "A", "A and B", "A, B, and C": the words between items come from the catalog. */
export function joinList(say: ListWords, items: string[]): string {
	if (items.length < 2) return items[0] ?? "";
	if (items.length === 2) {
		return say("two", { first: items[0] ?? "", second: items[1] ?? "" });
	}
	return say("many", {
		rest: items.slice(0, -1).join(say("separator")),
		last: items[items.length - 1] ?? "",
	});
}

/** A list in the person's language, the one way the app joins names. */
export function useList(): (items: string[]) => string {
	const t = useTranslations("mobile.composer.list");
	return (items) => joinList(t as unknown as ListWords, items);
}

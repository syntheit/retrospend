import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { addDays, localDay } from "~/components/pickers/dates";
import { useDateFormat } from "~/components/pickers/use-date-format";
import type { AnswerPart } from "~/components/ui/answer-line";
import { useCategoryName } from "~/hooks/use-category-name";
import { getDateFnsLocale } from "~/lib/date-locale";
import type { EntryCatalog } from "../shared-ui";
import type { EntryPerson } from "../types";
import { isShared } from "./draft";
import type { Project } from "./expense-fields";
import type { useExpenseDraft } from "./use-expense-draft";

/** Days offered as pills: Today, Yesterday, then the ones before. */
const DAYS_BACK = 6;

/**
 * The composer's answers so far, for the answer line: category (or the
 * attention "Pick a category"), day, who, project, note and spread. Each
 * part opens its panel through `go`. Also the day labels the When panel uses.
 */
export function useAnswers(p: {
	x: ReturnType<typeof useExpenseDraft>;
	catalog: EntryCatalog;
	you: EntryPerson;
	today: string;
	project: Project | null;
	showPeople: boolean;
	go: (tab: "category" | "when" | "who" | "project" | "more") => void;
}) {
	const t = useTranslations("entry.expense");
	const td = useTranslations("pickers.date");
	const df = useDateFormat();
	const { displayName } = useCategoryName();
	const { d } = p.x;
	const category = p.catalog.categories.find((c) => c.id === d.categoryId);
	const count = (d.youIncluded ? 1 : 0) + d.others.length;
	const same = (a: { participantId: string; participantType: string }) =>
		a.participantId === d.paidBy.participantId &&
		a.participantType === d.paidBy.participantType;
	const payer = same(p.you)
		? t("you")
		: ([...d.others, ...(d.outsidePayer ? [d.outsidePayer] : [])].find(same)
				?.name ?? "");
	const dayLabel = (iso: string) =>
		iso === p.today
			? td("today")
			: iso === addDays(p.today, -1)
				? td("yesterday")
				: format(localDay(iso), "EEE d", {
						locale: getDateFnsLocale(df.locale),
					});
	const days = Array.from({ length: DAYS_BACK + 1 }, (_, i) =>
		addDays(p.today, -i),
	);
	const whoText = isShared(d)
		? payer
			? t("summary.splitPaid", { count, name: payer })
			: t("summary.split", { count })
		: t("summary.solo");
	const parts: AnswerPart[] = [
		category
			? {
					id: "category",
					text: displayName(category.name),
					onSelect: () => p.go("category"),
				}
			: {
					id: "category",
					text: t("pickCategory"),
					tone: "attention",
					onSelect: () => p.go("category"),
				},
		{ id: "when", text: dayLabel(d.date), onSelect: () => p.go("when") },
		...(p.showPeople
			? [{ id: "who", text: whoText, onSelect: () => p.go("who") }]
			: []),
		...(p.project
			? [
					{
						id: "project",
						text: p.project.name,
						onSelect: () => p.go("project"),
					},
				]
			: []),
		...(d.note
			? [{ id: "note", text: t("note"), onSelect: () => p.go("more") }]
			: []),
		...(d.spread !== "one"
			? [
					{
						id: "spread",
						text: t("spreadMonths", { count: Number(d.spread) }),
						onSelect: () => p.go("more"),
					},
				]
			: []),
	];
	return { parts, days, dayLabel };
}

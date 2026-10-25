import { ACTIVITY_KINDS } from "@retrospend/api-contract";
import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import type { MenuItem } from "@/ui/types";
import type { ActivityFilter } from "./filter";
import { useCategories } from "./useCategories";

/**
 * The filter chips: period, type, category, person. Each opens the system
 * menu; a chip that is set says what it is set to instead of its own name.
 * The search bar is the screen header's (native).
 */
export function ActivityFilters({
	filter,
	onChange,
}: {
	filter: ActivityFilter;
	onChange: (next: ActivityFilter) => void;
}) {
	const t = useTranslations("mobile.activity");
	const { space } = useTheme();
	const categories = useCategories();
	const people = usePeopleOverview();

	const periodItems: MenuItem[] = (["month", "all"] as const).map((period) => ({
		id: period,
		label: t(`period.${period}`),
		onPress: () => onChange({ ...filter, period }),
	}));

	const kindItems: MenuItem[] = [
		{
			id: "any",
			label: t("chip.anyKind"),
			onPress: () => onChange({ ...filter, kind: null }),
		},
		...ACTIVITY_KINDS.map((kind) => ({
			id: kind,
			label: t(`kind.${kind}`),
			onPress: () => onChange({ ...filter, kind }),
		})),
	];

	const categoryList =
		categories.state.status === "ready" ? categories.state.data : [];
	const categoryItems: MenuItem[] = [
		{
			id: "all",
			label: t("chip.allCategories"),
			onPress: () => onChange({ ...filter, categoryId: null }),
		},
		...categoryList.map((c) => ({
			id: c.id,
			label: c.name,
			onPress: () => onChange({ ...filter, categoryId: c.id }),
		})),
	];

	const peopleList =
		people.state.status === "ready" ? people.state.data.people : [];
	const personItems: MenuItem[] = [
		{
			id: "all",
			label: t("chip.everyone"),
			onPress: () => onChange({ ...filter, personKey: null }),
		},
		...peopleList.map((p) => ({
			id: p.person.key,
			label: p.person.name,
			onPress: () => onChange({ ...filter, personKey: p.person.key }),
		})),
	];

	const category = categoryList.find((c) => c.id === filter.categoryId);
	const person = peopleList.find((p) => p.person.key === filter.personKey);

	return (
		<ScrollView
			contentContainerStyle={{
				alignItems: "center",
				gap: space[4],
				paddingHorizontal: space[4],
				paddingVertical: space[1],
			}}
			horizontal
			keyboardShouldPersistTaps="handled"
			showsHorizontalScrollIndicator={false}
		>
			<Menu items={periodItems} label={t(`period.${filter.period}`)} />
			<Menu
				items={kindItems}
				label={filter.kind ? t(`kind.${filter.kind}`) : t("chip.kind")}
			/>
			<Menu
				items={categoryItems}
				label={category ? category.name : t("chip.category")}
			/>
			<Menu
				items={personItems}
				label={person ? person.person.name : t("chip.person")}
			/>
		</ScrollView>
	);
}

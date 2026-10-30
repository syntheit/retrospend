import { ACTIVITY_KINDS } from "@retrospend/api-contract";
import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useProjectList } from "@/features/projects/useProjects";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import type { MenuItem } from "@/ui/types";
import type { ActivityFilter } from "./filter";
import { useCategories } from "./useCategories";

/**
 * The filter chips: period, category, person, project, and Filter (type).
 * Each opens a menu; a chip that is set says what it is set to instead of its
 * own name and turns brand-soft. The search bar is the screen header's
 * (native).
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
	const projects = useProjectList();

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

	const projectList =
		projects.state.status === "ready" ? projects.state.data.items : [];
	const projectItems: MenuItem[] = [
		{
			id: "all",
			label: t("chip.allProjects"),
			onPress: () => onChange({ ...filter, projectId: null }),
		},
		...projectList.map((p) => ({
			id: p.id,
			label: p.name,
			onPress: () => onChange({ ...filter, projectId: p.id }),
		})),
	];

	const category = categoryList.find((c) => c.id === filter.categoryId);
	const person = peopleList.find((p) => p.person.key === filter.personKey);
	const project = projectList.find((p) => p.id === filter.projectId);

	return (
		<ScrollView
			contentContainerStyle={{
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: space[4],
				paddingVertical: space[1],
			}}
			horizontal
			keyboardShouldPersistTaps="handled"
			showsHorizontalScrollIndicator={false}
		>
			<Menu
				active
				chip
				items={periodItems}
				label={t(`period.${filter.period}`)}
			/>
			<Menu
				active={category !== undefined}
				chip
				items={categoryItems}
				label={category ? category.name : t("chip.category")}
			/>
			<Menu
				active={person !== undefined}
				chip
				items={personItems}
				label={person ? person.person.name : t("chip.person")}
			/>
			<Menu
				active={project !== undefined}
				chip
				items={projectItems}
				label={project ? project.name : t("chip.project")}
			/>
			<Menu
				active={filter.kind !== null}
				chip
				items={kindItems}
				label={filter.kind ? t(`kind.${filter.kind}`) : t("chip.filter")}
			/>
		</ScrollView>
	);
}

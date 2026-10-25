import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { ProjectsList } from "@/features/projects/ProjectsList";
import { useTheme } from "@/theme";
import { Segmented } from "@/ui/Segmented";
import { PeopleList } from "./PeopleList";
import {
	type PeopleSegment,
	parseSegment,
	readSegment,
	writeSegment,
} from "./segment";

/**
 * The People tab on phones: People and Projects behind one native segmented
 * control at the top of the list (the fifth bar slot belongs to Add). The last
 * choice is remembered; a link or redirect that names a segment wins.
 */
export function PeopleHub() {
	const t = useTranslations("mobile.tabs");
	const tp = useTranslations("mobile.people");
	const { color, space } = useTheme();
	const { segment: requested } = useLocalSearchParams<{ segment?: string }>();
	const [segment, setSegment] = useState<PeopleSegment>(
		() => parseSegment(requested) ?? readSegment(),
	);

	useEffect(() => {
		const next = parseSegment(requested);
		if (next) setSegment(next);
	}, [requested]);

	function choose(next: PeopleSegment) {
		setSegment(next);
		writeSegment(next);
	}

	const switcher = (
		<View
			style={{
				paddingHorizontal: space[4],
				paddingTop: space[2],
				paddingBottom: space[2],
				backgroundColor: color.bg,
			}}
		>
			<Segmented
				accessibilityLabel={tp("segmentLabel")}
				onChange={choose}
				options={[
					{ value: "people", label: t("people") },
					{ value: "projects", label: t("projects") },
				]}
				value={segment}
			/>
		</View>
	);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			<AccountTopBar
				title={segment === "people" ? t("people") : t("projects")}
			/>
			{segment === "people" ? (
				<PeopleList top={switcher} />
			) : (
				<ProjectsList top={switcher} />
			)}
		</View>
	);
}

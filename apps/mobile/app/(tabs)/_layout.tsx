import { router } from "expo-router";
import { useTranslations } from "use-intl";
import {
	AddEntryProvider,
	useAddEntry,
} from "@/features/entry/AddEntryProvider";
import { focusSearch } from "@/layout/searchShortcut";
import { useHardwareKeys } from "@/layout/useHardwareKeys";
import { Tabs } from "@/ui/Tabs";

// The tabs open on Home, and system back returns to it (Android's floating bar).
export const unstable_settings = { initialRouteName: "home" };

function TabsWithAdd() {
	const t = useTranslations("mobile.composer");
	const tt = useTranslations("mobile.tabs");
	const { open } = useAddEntry();
	useHardwareKeys(
		{ add: t("addExpense"), search: tt("search") },
		{
			add: () => open("expense"),
			search: () => {
				if (!focusSearch()) router.push("/home/search");
			},
		},
	);
	return <Tabs />;
}

export default function TabsLayout() {
	return (
		<AddEntryProvider>
			<TabsWithAdd />
		</AddEntryProvider>
	);
}

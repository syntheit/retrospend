import { useTranslations } from "use-intl";
import {
	AddEntryProvider,
	useAddEntry,
} from "@/features/entry/AddEntryProvider";
import { Tabs } from "@/ui/Tabs";

function TabsWithAdd() {
	const t = useTranslations("mobile.composer");
	const { open } = useAddEntry();
	return <Tabs addLabel={t("addExpense")} onAdd={() => open("expense")} />;
}

export default function TabsLayout() {
	return (
		<AddEntryProvider>
			<TabsWithAdd />
		</AddEntryProvider>
	);
}

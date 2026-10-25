import { AddEntryProvider } from "@/features/entry/AddEntryProvider";
import { Tabs } from "@/ui/Tabs";

export default function TabsLayout() {
	return (
		<AddEntryProvider>
			<Tabs />
		</AddEntryProvider>
	);
}

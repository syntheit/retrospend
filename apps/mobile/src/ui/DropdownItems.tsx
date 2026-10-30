import {
	Text as ComposeText,
	DropdownMenuItem,
	RNHostView,
} from "@expo/ui/jetpack-compose";
import { useTheme } from "@/theme";
import type { MenuItem } from "./types";

/**
 * The items of an M3 dropdown (Menu and RowMenu on Android): the label, in
 * danger for a destructive one, and the item's `lead` mark in the leading slot.
 */
export function DropdownItems({
	items,
	onPick,
}: {
	items: MenuItem[];
	onPick: (item: MenuItem) => void;
}) {
	const { color } = useTheme();
	return (
		<>
			{items.map((item) => (
				<DropdownMenuItem key={item.id} onClick={() => onPick(item)}>
					<DropdownMenuItem.Text>
						<ComposeText color={item.destructive ? color.danger : undefined}>
							{item.label}
						</ComposeText>
					</DropdownMenuItem.Text>
					{item.lead ? (
						<DropdownMenuItem.LeadingIcon>
							<RNHostView matchContents>{item.lead}</RNHostView>
						</DropdownMenuItem.LeadingIcon>
					) : null}
				</DropdownMenuItem>
			))}
		</>
	);
}

import {
	Text as ComposeText,
	DropdownMenuItem,
	RNHostView,
} from "@expo/ui/jetpack-compose";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import type { MenuItem } from "./types";

/**
 * The items of an M3 dropdown (Menu and RowMenu on Android): the label, in
 * danger for a destructive one, and the item's `lead` mark (else its `icon` glyph) in the leading slot.
 */
export function DropdownItems({
	items,
	onPick,
}: {
	items: MenuItem[];
	onPick: (item: MenuItem) => void;
}) {
	const { color, size } = useTheme();
	return (
		<>
			{items.map((item) => {
				const mark =
					item.lead ??
					(item.icon ? (
						<Glyph
							color={item.destructive ? color.danger : color.fg2}
							name={item.icon}
							size={size.icon.phone}
						/>
					) : null);
				return (
					<DropdownMenuItem key={item.id} onClick={() => onPick(item)}>
						<DropdownMenuItem.Text>
							<ComposeText color={item.destructive ? color.danger : undefined}>
								{item.label}
							</ComposeText>
						</DropdownMenuItem.Text>
						{mark ? (
							<DropdownMenuItem.LeadingIcon>
								<RNHostView matchContents>{mark}</RNHostView>
							</DropdownMenuItem.LeadingIcon>
						) : null}
					</DropdownMenuItem>
				);
			})}
		</>
	);
}

import {
	Text as ComposeText,
	DropdownMenu,
	DropdownMenuItem,
	HorizontalDivider,
	RNHostView,
} from "@expo/ui/jetpack-compose";
import { defaultMinSize, padding } from "@expo/ui/jetpack-compose/modifiers";
import { Fragment, type ReactNode } from "react";
import { useTheme } from "@/theme";
import { fontFamilyFor } from "@/theme/fonts";
import { Glyph } from "./Glyph";
import { useChromeTextSize } from "./Text";
import type { MenuItem } from "./types";

/**
 * The M3 menu's measurements, in dp. The container is the Material 3
 * Expressive menu (16 dp corners, an 8 dp lift); items are 48 dp tall with
 * 16 dp of side padding (the item's own 12 plus the 4 added here), a 20 dp
 * leading mark and 12 dp between it and the label.
 */
const MENU = {
	corner: 16,
	elevation: 8,
	itemSide: 4,
	minWidth: 200,
	icon: 20,
	label: 16,
	groupGap: 4,
} as const;

/**
 * The container of an M3 dropdown (Menu, RowMenu and ValueMenu on Android):
 * the surface token, a rounded 16 dp shape and a real lift, so it reads as a
 * floating layer and not as a patch of the page. `trigger` is the anchor the
 * menu hangs from; `items` are the rows.
 */
export function DropdownPanel({
	open,
	onDismiss,
	items,
	onPick,
	trigger,
}: {
	open: boolean;
	onDismiss: () => void;
	items: MenuItem[];
	onPick: (item: MenuItem) => void;
	trigger: ReactNode;
}) {
	const { color } = useTheme();
	return (
		<DropdownMenu
			color={color.surface}
			cornerRadius={MENU.corner}
			expanded={open}
			onDismissRequest={onDismiss}
			shadowElevation={MENU.elevation}
		>
			<DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Items>
				<DropdownItems items={items} onPick={onPick} />
			</DropdownMenu.Items>
		</DropdownMenu>
	);
}

/**
 * The items of an M3 dropdown: DM Sans labels in fg, a 20 dp leading mark in
 * fg-2 (the item's `lead` identity mark, else its `icon` glyph), and the
 * destructive item in danger with its own glyph, set apart by a hairline.
 */
export function DropdownItems({
	items,
	onPick,
}: {
	items: MenuItem[];
	onPick: (item: MenuItem) => void;
}) {
	const { color } = useTheme();
	const labelSize = useChromeTextSize(MENU.label);
	return (
		<>
			{items.map((item, index) => {
				const tone = item.destructive ? color.danger : color.fg;
				const mark =
					item.lead ??
					(item.icon ? (
						<Glyph
							color={item.destructive ? color.danger : color.fg2}
							name={item.icon}
							size={MENU.icon}
						/>
					) : null);
				// A destructive item after other items starts its own group.
				const startsGroup =
					item.destructive && index > 0 && !items[index - 1]?.destructive;
				return (
					<Fragment key={item.id}>
						{startsGroup ? (
							<HorizontalDivider
								color={color.line}
								modifiers={[padding(0, MENU.groupGap, 0, MENU.groupGap)]}
								thickness={1}
							/>
						) : null}
						<DropdownMenuItem
							elementColors={{ textColor: tone, leadingIconColor: tone }}
							modifiers={[defaultMinSize({ minWidth: MENU.minWidth })]}
							onClick={() => onPick(item)}
						>
							<DropdownMenuItem.Text>
								<ComposeText
									color={tone}
									maxLines={1}
									modifiers={[padding(MENU.itemSide, 0, MENU.itemSide, 0)]}
									overflow="ellipsis"
									style={{
										fontFamily: fontFamilyFor(400),
										fontSize: labelSize,
									}}
								>
									{item.label}
								</ComposeText>
							</DropdownMenuItem.Text>
							{mark ? (
								<DropdownMenuItem.LeadingIcon>
									<RNHostView
										matchContents
										modifiers={[padding(MENU.itemSide, 0, 0, 0)]}
									>
										{mark}
									</RNHostView>
								</DropdownMenuItem.LeadingIcon>
							) : null}
						</DropdownMenuItem>
					</Fragment>
				);
			})}
		</>
	);
}

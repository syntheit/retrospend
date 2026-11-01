import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import { filterGroups, type PickGroup, type PickRow } from "./pickGroups";
import { Sheet, useSheetBodySize } from "./Sheet";

type Item =
	| { kind: "heading"; key: string; text: string }
	| { kind: "row"; key: string; row: PickRow };

/**
 * The one list picker: the platform sheet (a SwiftUI sheet, a form sheet on
 * iPad; an M3 modal bottom sheet) at medium, pulled up to large, holding a
 * search field and the choices in groups under 13 fg-3 headings. Each row
 * has its identity in front, its name at 14/500 over a 12 fg-3 detail line,
 * and a check on the current one (GUIDELINE 8: pickers carry identity).
 * Typing narrows the list, ignoring case and accents. With `multiple` a tap
 * toggles the row and the sheet stays open (a check per chosen row); Done in
 * the header closes it. With `full` it opens at the large detent only.
 */
export function PickerSheet({
	visible,
	onClose,
	title,
	find,
	empty,
	clear,
	groups,
	onSelect,
	multiple,
	full,
}: {
	visible: boolean;
	onClose: () => void;
	title: string;
	/** The search field's hint and its spoken name. */
	find: string;
	empty: string;
	/** The spoken name of the button that clears the search. */
	clear: string;
	groups: PickGroup[];
	/** Called with the id pressed; with `multiple` it toggles that id. */
	onSelect: (id: string) => void;
	/** Several rows can be chosen: taps do not close, Done does. */
	multiple?: boolean;
	/** Opens at the full height the sheet can have (a long list, a main choice), with no medium stop. */
	full?: boolean;
}) {
	const { color, font, radius, size, space, type } = useTheme();
	const body = useSheetBodySize();
	const [query, setQuery] = useState("");
	const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
	const items = useMemo<Item[]>(
		() =>
			shown.flatMap((g) => [
				{ kind: "heading" as const, key: `h:${g.key}`, text: g.heading },
				...g.rows.map((row) => ({
					kind: "row" as const,
					key: `${g.key}:${row.id}`,
					row,
				})),
			]),
		[shown],
	);

	function close() {
		setQuery("");
		onClose();
	}

	return (
		<Sheet
			detents={full ? ["large"] : ["medium", "large"]}
			dismiss={multiple ? "done" : undefined}
			onClose={close}
			title={title}
			visible={visible}
		>
			<View style={{ ...body, gap: space[2] }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						minHeight: size.touchMin.phone,
						gap: space[2],
						paddingLeft: space[3],
						borderRadius: radius.ctl,
						backgroundColor: color.raised,
					}}
				>
					<Glyph color={color.fg2} name="Search" size={size.icon.phone} />
					<TextInput
						accessibilityLabel={find}
						autoCapitalize="none"
						autoCorrect={false}
						onChangeText={setQuery}
						placeholder={find}
						placeholderTextColor={color.fg3}
						returnKeyType="search"
						style={{
							flex: 1,
							minHeight: size.touchMin.phone,
							color: color.fg,
							fontSize: type.body.size,
						}}
						value={query}
					/>
					{query ? (
						<Pressable
							accessibilityLabel={clear}
							accessibilityRole="button"
							hitSlop={space[1]}
							onPress={() => setQuery("")}
							style={{
								width: size.touchMin.phone,
								height: size.touchMin.phone,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Glyph color={color.fg2} name="X" size={size.icon.phone} />
						</Pressable>
					) : null}
				</View>
				{items.length === 0 ? (
					<Text
						style={{
							color: color.fg2,
							fontSize: type.body.size,
							paddingVertical: space[6],
							textAlign: "center",
						}}
					>
						{empty}
					</Text>
				) : (
					<FlatList
						data={items}
						initialNumToRender={20}
						keyboardShouldPersistTaps="handled"
						keyExtractor={(item) => item.key}
						renderItem={({ item }) =>
							item.kind === "heading" ? (
								<Text
									accessibilityRole="header"
									style={{
										color: color.fg3,
										fontSize: type.small.size,
										paddingTop: space[3],
										paddingBottom: space[1],
									}}
								>
									{item.text}
								</Text>
							) : (
								<Pressable
									accessibilityLabel={[item.row.label, item.row.detail]
										.filter(Boolean)
										.join(", ")}
									accessibilityRole={multiple ? "checkbox" : "button"}
									accessibilityState={
										multiple
											? { checked: item.row.selected }
											: { selected: item.row.selected }
									}
									onPress={() => {
										onSelect(item.row.id);
										if (!multiple) close();
									}}
									style={({ pressed }) => ({
										minHeight: size.row.phone,
										flexDirection: "row",
										alignItems: "center",
										gap: space[3],
										backgroundColor: pressed ? color.raised : undefined,
									})}
								>
									<View
										style={{
											width: size.avatar.sm,
											alignItems: "center",
										}}
									>
										{item.row.lead}
									</View>
									<View style={{ flex: 1, paddingVertical: space[1] }}>
										<Text
											numberOfLines={1}
											style={{
												color: color.fg,
												fontSize: type.body.size,
												fontWeight: String(font.weight.medium) as "500",
											}}
										>
											{item.row.label}
										</Text>
										{item.row.detail ? (
											<Text
												numberOfLines={1}
												style={{ color: color.fg3, fontSize: type.meta.size }}
											>
												{item.row.detail}
											</Text>
										) : null}
									</View>
									{item.row.selected ? (
										<Glyph
											color={color.brand}
											name="Check"
											size={size.icon.phone}
										/>
									) : null}
								</Pressable>
							)
						}
					/>
				)}
			</View>
		</Sheet>
	);
}

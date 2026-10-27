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
 * iPad; an M3 modal bottom sheet) holding a search field and the choices in
 * groups, each with its identity in front and a check on the current one
 * (GUIDELINE 8: pickers carry identity). Typing narrows the list, ignoring
 * case and accents.
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
	onSelect: (id: string) => void;
}) {
	const { color, radius, size, space, type } = useTheme();
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
		<Sheet detents={["large"]} onClose={close} title={title} visible={visible}>
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
										color: color.fg2,
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
									accessibilityRole="button"
									accessibilityState={{ selected: item.row.selected }}
									onPress={() => {
										onSelect(item.row.id);
										close();
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
									<Text
										numberOfLines={1}
										style={{ flex: 1, fontSize: type.body.size }}
									>
										<Text
											style={{
												color: color.fg,
												fontWeight: item.row.detail ? "500" : "400",
											}}
										>
											{item.row.label}
										</Text>
										{item.row.detail ? (
											<Text style={{ color: color.fg2 }}>
												{`  ${item.row.detail}`}
											</Text>
										) : null}
									</Text>
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

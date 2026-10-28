import { CATEGORY_COLORS } from "@retrospend/api-contract";
import { CATEGORY_ICON_NAMES } from "@retrospend/domain/category-icons";
import { categoryTone } from "@retrospend/domain/category-tone";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { Note, SheetBody } from "@/features/budget/parts";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { categoryColor, Glyph } from "@/ui/Glyph";
import { Sheet } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import {
	type Category,
	type CategoryColor,
	type CategoryDraft,
	changesOf,
	draftOf,
	draftValid,
	nameTaken,
} from "./source";

function Choice({
	selected,
	label,
	onPress,
	children,
}: {
	selected: boolean;
	label: string;
	onPress: () => void;
	children: React.ReactNode;
}) {
	const { color, radius, size } = useTheme();
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			accessibilityState={{ selected }}
			onPress={onPress}
			style={{
				width: size.touchMin.phone,
				height: size.touchMin.phone,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: radius.ctl,
				borderWidth: selected ? 2 : 1,
				borderColor: selected ? color.brand : color.line,
			}}
		>
			{children}
		</Pressable>
	);
}

/**
 * Add or edit a category: name, color (one of the 21 shared slots) and icon
 * (the shared set). Each choice shows the glyph the web draws; the color
 * name is the accessibility label. Saves at once and says so in a toast.
 */
export function CategorySheet({
	category,
	all,
	visible,
	onClose,
	onDone,
}: {
	/** Null adds a new category. */
	category: Category | null;
	all: readonly Category[];
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.settings.categories");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { color, space, type } = useTheme();
	const [draft, setDraft] = useState<CategoryDraft>(draftOf(category));
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const key = useRef(newClientId());

	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts from the saved values with a fresh write key
	useEffect(() => {
		if (!visible) return;
		setDraft(draftOf(category));
		setFailed(false);
		key.current = newClientId();
	}, [visible]);

	const taken = nameTaken(draft, all, category?.id ?? null);
	const changes = category ? changesOf(draft, category) : null;
	const ready =
		draftValid(draft) &&
		!taken &&
		(changes === null || Object.keys(changes).length > 0);
	const set = (patch: Partial<CategoryDraft>) =>
		setDraft((previous) => ({ ...previous, ...patch }));
	const tone = categoryTone(draft.color);
	const accent = categoryColor(color, tone);

	async function save() {
		if (!api || busy || !ready) return;
		setBusy(true);
		setFailed(false);
		const options = { context: { idempotencyKey: key.current } };
		try {
			if (category) {
				await api.categories.update({ id: category.id, ...changes }, options);
			} else {
				await api.categories.create(
					{
						name: draft.name.trim(),
						color: draft.color,
						...(draft.icon ? { icon: draft.icon } : {}),
						excludeByDefault: draft.excludeByDefault,
					},
					options,
				);
			}
			toast.show({ message: t("saved", { name: draft.name.trim() }) });
			onDone();
			onClose();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	const small = { color: color.fg2, fontSize: type.small.size } as const;
	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={category ? t("editTitle") : t("addTitle")}
			visible={visible}
		>
			<SheetBody>
				<TextField
					autoCapitalize="sentences"
					invalid={taken}
					label={t("name")}
					onChangeText={(name) => set({ name })}
					value={draft.name}
				/>
				{taken ? <Note tone="attention">{t("taken")}</Note> : null}
				<View style={{ gap: space[2] }}>
					<Text style={small}>{t("color")}</Text>
					<View
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
					>
						{CATEGORY_COLORS.map((name: CategoryColor, index) => {
							const fill = categoryColor(color, categoryTone(name));
							return (
								<Choice
									key={name}
									label={t("colorLabel", { n: index + 1 })}
									onPress={() => set({ color: name })}
									selected={draft.color === name}
								>
									<View
										style={{
											width: space[6],
											height: space[6],
											borderRadius: space[3],
											backgroundColor: fill,
										}}
									/>
								</Choice>
							);
						})}
					</View>
				</View>
				<View style={{ gap: space[2] }}>
					<Text style={small}>{t("icon")}</Text>
					<View
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
					>
						{CATEGORY_ICON_NAMES.map((name) => (
							<Choice
								key={name}
								label={t("iconLabel", { name })}
								onPress={() => set({ icon: name })}
								selected={draft.icon === name}
							>
								<Glyph color={accent} name={name} size={space[6]} />
							</Choice>
						))}
					</View>
				</View>
				<SwitchRow
					detail={t("excludeHint")}
					label={t("exclude")}
					onChange={(excludeByDefault) => set({ excludeByDefault })}
					value={draft.excludeByDefault}
				/>
				{failed ? <Note tone="attention">{t("saveError")}</Note> : null}
				<Button
					disabled={busy || !ready}
					label={busy ? tc("saving") : tc("save")}
					onPress={save}
				/>
			</SheetBody>
		</Sheet>
	);
}

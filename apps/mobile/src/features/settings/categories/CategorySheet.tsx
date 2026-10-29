import { CATEGORY_COLORS } from "@retrospend/api-contract";
import { CATEGORY_ICON_NAMES } from "@retrospend/domain/category-icons";
import { categoryTone } from "@retrospend/domain/category-tone";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { Note } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { categoryColor, Glyph } from "@/ui/Glyph";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { SwitchRow } from "@/ui/SwitchRow";
import { FieldLabel, TextField } from "@/ui/TextField";
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

/**
 * One pick in a grid, at the 44 point target. A swatch is a 28 round fill
 * with a 2 point ring in fg while picked; an icon is a 36 square that takes
 * the brand-soft fill and a brand border while picked.
 */
function Choice({
	selected,
	label,
	onPress,
	shape,
	fill,
	children,
}: {
	selected: boolean;
	label: string;
	onPress: () => void;
	shape: "swatch" | "icon";
	/** A swatch's color. */
	fill?: string;
	children?: React.ReactNode;
}) {
	const { color, radius, size, space } = useTheme();
	const round = shape === "swatch";
	const box = round ? size.ctlSm.phone : size.ctl.phone;
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			accessibilityState={{ selected }}
			hitSlop={(size.touchMin.phone - box) / 2}
			onPress={onPress}
			style={{
				width: box,
				height: box,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: round ? box / 2 : radius.ctl,
				borderWidth: round ? space[1] / 2 : 1,
				borderColor: selected
					? round
						? color.fg
						: color.brand
					: "transparent",
				backgroundColor: round ? fill : selected ? color.brandSoft : undefined,
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
	const { color, size, space } = useTheme();
	const body = useSheetBodySize({ footer: true });
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

	return (
		<Sheet
			detents={["large"]}
			footer={
				<Button
					disabled={busy || !ready}
					label={busy ? tc("saving") : tc("save")}
					onPress={save}
				/>
			}
			onClose={onClose}
			title={category ? t("editTitle") : t("addTitle")}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ height: body.height }}
			>
				<TextField
					autoCapitalize="sentences"
					invalid={taken}
					label={t("name")}
					onChangeText={(name) => set({ name })}
					value={draft.name}
				/>
				{taken ? <Note tone="attention">{t("taken")}</Note> : null}
				<View style={{ gap: space[2] }}>
					<FieldLabel>{t("color")}</FieldLabel>
					<View
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
					>
						{CATEGORY_COLORS.map((name: CategoryColor, index) => (
							<Choice
								fill={categoryColor(color, categoryTone(name))}
								key={name}
								label={t("colorLabel", { n: index + 1 })}
								onPress={() => set({ color: name })}
								selected={draft.color === name}
								shape="swatch"
							/>
						))}
					</View>
				</View>
				<View style={{ gap: space[2] }}>
					<FieldLabel>{t("icon")}</FieldLabel>
					<View
						style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}
					>
						{CATEGORY_ICON_NAMES.map((name) => (
							<Choice
								key={name}
								label={t("iconLabel", { name })}
								onPress={() => set({ icon: name })}
								selected={draft.icon === name}
								shape="icon"
							>
								<Glyph color={accent} name={name} size={size.icon.phone} />
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
			</ScrollView>
		</Sheet>
	);
}

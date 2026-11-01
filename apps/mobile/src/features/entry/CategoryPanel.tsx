import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { usePanelRoom } from "@/ui/DetailPager";
import { GlyphPill } from "@/ui/GlyphPill";
import { FieldError } from "@/ui/TextField";
import { CategoryPicker } from "./CategoryPicker";
import { recentCategories } from "./catalog";
import type { ExpenseDraft } from "./draft";
import type { EntryCatalog, EntryCategory } from "./types";

/** The most categories that show as pills before the rest wait behind More. */
const SHOWN = 6;

/**
 * The category, in place: your most used first as pills, each with its own
 * glyph in its color (bare, no tile), then a More pill, which opens the
 * full-height searchable list. The picked pill has the brand border and fill; a pick
 * from the full list takes the first slot so it is always on screen. On a
 * short window the panel has room for few rows: pills are dropped from the end
 * until the More pill is on screen without scrolling. A saved
 * category that is not in your catalog (someone else's, on their split)
 * stays offered.
 */
export function CategoryPanel({
	catalog,
	draft,
	error,
	onPick,
}: {
	catalog: EntryCatalog;
	draft: Pick<ExpenseDraft, "categoryId" | "editing">;
	/** Shown once Add was pressed. */
	error: boolean;
	onPick: (category: EntryCategory | { id: string }) => void;
}) {
	const t = useTranslations("mobile.composer");
	const { size, space } = useTheme();
	const room = usePanelRoom();
	// How many pills the panel's rows hold: start at six, drop one at a time
	// while the pills (with More) are taller than the room, and start again when
	// the room grows (the keys folded away).
	const [count, setCount] = useState(SHOWN);
	const [settled, setSettled] = useState(false);
	const lastRoom = useRef(room);
	useEffect(() => {
		const before = lastRoom.current;
		lastRoom.current = room;
		if (room !== null && (before === null || room > before + size.ctl.phone)) {
			setCount(SHOWN);
		}
	}, [room, size.ctl.phone]);
	const measure = (event: LayoutChangeEvent) => {
		const { height } = event.nativeEvent.layout;
		if (room === null) return;
		if (height > room && count > 1) setCount(count - 1);
		else setSettled(true);
	};
	const shown = recentCategories(catalog, count, draft.categoryId);
	// Someone else's category on their split: not in your catalog, but kept.
	const saved =
		draft.editing?.category &&
		!catalog.categories.some((c) => c.id === draft.editing?.category?.id)
			? draft.editing.category
			: null;
	return (
		<View style={{ gap: space[2] }}>
			<View
				accessibilityLabel={t("category")}
				onLayout={measure}
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					gap: space[2],
					// Hidden for the first layout only, while the count settles.
					opacity: settled || room === null ? 1 : 0,
				}}
			>
				{saved ? (
					<GlyphPill
						glyph="Tag"
						label={saved.name}
						onPress={() => onPick({ id: saved.id })}
						selected={draft.categoryId === saved.id}
					/>
				) : null}
				{shown.map((category) => (
					<GlyphPill
						category={category}
						key={category.id}
						label={category.name}
						onPress={() => onPick(category)}
						selected={draft.categoryId === category.id}
					/>
				))}
				{catalog.categories.length > shown.length ? (
					<CategoryPicker
						categories={catalog.categories}
						onChange={(id) =>
							onPick(catalog.categories.find((c) => c.id === id) ?? { id })
						}
						recent={shown}
						value={draft.categoryId}
					/>
				) : null}
			</View>
			{error ? <FieldError>{t("errors.category")}</FieldError> : null}
		</View>
	);
}

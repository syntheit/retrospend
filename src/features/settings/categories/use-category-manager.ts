import { guessCategoryIconName } from "@retrospend/domain/category-icons";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { useCategoryName } from "~/hooks/use-category-name";
import type { CategoryColor } from "~/lib/constants";
import { api } from "~/trpc/react";
import { nameChanged } from "./name-changed";

// 12 visually distinct colors, one clear step apart across the spectrum
const PICKER_COLORS: CategoryColor[] = [
	"red",
	"rose",
	"orange",
	"amber",
	"lime",
	"emerald",
	"teal",
	"sky",
	"blue",
	"indigo",
	"purple",
	"slate",
];

export interface CategoryManagerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Open on this category instead of the first (the new Settings rows). */
	initialCategoryId?: string | null;
	/** What to do once open: add a new category, or open the delete sheet on the initial one. */
	intent?: "add" | "delete" | null;
}

interface CategoryData {
	name: string;
	icon?: string | null;
	color: string;
	excludeByDefault: boolean;
}

/** The category manager's state: selection, the edit fields and every save and create. */
export function useCategoryManager({
	open,
	onOpenChange,
	initialCategoryId = null,
	intent = null,
}: CategoryManagerProps) {
	const t = useTranslations("settingsPage");
	const toast = useToast();
	const { displayName, toDbName } = useCategoryName();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [mobileView, setMobileView] = useState<"list" | "detail">("list");

	// Edit state
	const [editName, setEditName] = useState("");
	const [editIcon, setEditIcon] = useState("Tag");
	const [editColor, setEditColor] = useState<CategoryColor>("emerald");
	const [editExclude, setEditExclude] = useState(false);

	// Ref for latest edit state (prevents stale closures in debounced saves)
	const editStateRef = useRef({
		name: "",
		icon: "Tag",
		color: "emerald" as CategoryColor,
		excludeByDefault: false,
	});
	editStateRef.current = {
		name: editName,
		icon: editIcon,
		color: editColor,
		excludeByDefault: editExclude,
	};

	// Save indicator
	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
		"idle",
	);
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const nameDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const nameInputRef = useRef<HTMLInputElement>(null);

	// The delete and merge sheet
	const [removing, setRemoving] = useState(false);

	// tRPC
	const { data: categories, refetch: refetchCategories } =
		api.categories.getAll.useQuery();
	const createMutation = api.categories.create.useMutation();
	const updateMutation = api.categories.update.useMutation();

	const selectedCategory = categories?.find((c) => c.id === selectedId);

	// Populate editor fields from a category object
	const syncEditor = useCallback(
		(cat: CategoryData) => {
			setEditName(displayName(cat.name));
			setEditIcon(cat.icon || guessCategoryIconName(cat.name));
			setEditColor(cat.color as CategoryColor);
			setEditExclude(cat.excludeByDefault);
		},
		[displayName],
	);

	const flashSaved = useCallback(() => {
		setSaveStatus("saved");
		if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
		saveTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
	}, []);

	// Core save: takes explicit id + values to avoid stale closures
	const saveCategory = useCallback(
		async (
			id: string,
			values: {
				name: string;
				icon: string;
				color: CategoryColor;
				excludeByDefault: boolean;
			},
		) => {
			if (!values.name.trim()) return;
			setSaveStatus("saving");
			// Reverse-map: if the category is a default and the name matches
			// its translation, preserve the original English key in the DB
			const currentCategory = categories?.find((c) => c.id === id);
			const nameToSave = currentCategory
				? toDbName(currentCategory.name, values.name.trim())
				: values.name.trim();
			try {
				await updateMutation.mutateAsync({
					id,
					// A rename is a new version of the category: left out when the
					// person did not change the name, so a save of anything else
					// does not park a device's pending edit.
					...(nameChanged(currentCategory?.name, nameToSave)
						? { name: nameToSave }
						: {}),
					color: values.color,
					icon: values.icon,
					excludeByDefault: values.excludeByDefault,
				});
				await refetchCategories();
				flashSaved();
			} catch (err) {
				setSaveStatus("idle");
				toast.failed(err instanceof Error ? err.message : t("failedToSave"));
			}
		},
		[
			updateMutation,
			refetchCategories,
			flashSaved,
			categories,
			toDbName,
			toast,
			t,
		],
	);

	const saveFnRef = useRef(saveCategory);
	saveFnRef.current = saveCategory;

	// Auto-select the initial category (else the first) when dialog opens
	useEffect(() => {
		if (!open || selectedId || !categories?.length) return;
		const first =
			categories.find((c) => c.id === initialCategoryId) ?? categories[0];
		if (!first) return;
		setSelectedId(first.id);
		syncEditor(first);
	}, [open, categories, selectedId, syncEditor, initialCategoryId]);

	// Reset mobile view when dialog opens (the detail when opened on a category)
	useEffect(() => {
		if (open) setMobileView(initialCategoryId ? "detail" : "list");
	}, [open, initialCategoryId]);

	// Cleanup timeouts
	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
			if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
		};
	}, []);

	// Flush pending name debounce (called before switching selection or closing)
	const flushPendingSave = useCallback(() => {
		if (nameDebounceRef.current && selectedId) {
			clearTimeout(nameDebounceRef.current);
			nameDebounceRef.current = undefined;
			const state = editStateRef.current;
			if (state.name.trim()) {
				saveFnRef.current(selectedId, state);
			}
		}
	}, [selectedId]);

	// Select a category (flush pending save first)
	const handleSelectCategory = useCallback(
		(id: string) => {
			flushPendingSave();
			const cat = categories?.find((c) => c.id === id);
			setSelectedId(id);
			if (cat) syncEditor(cat);
			setMobileView("detail");
			setSaveStatus("idle");
		},
		[flushPendingSave, categories, syncEditor],
	);

	// Dialog close handler
	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				flushPendingSave();
				setSelectedId(null);
			}
			onOpenChange(nextOpen);
		},
		[flushPendingSave, onOpenChange],
	);

	// --- Field change handlers ---

	const handleNameChange = useCallback(
		(value: string) => {
			setEditName(value);
			editStateRef.current.name = value;
			if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
			const id = selectedId;
			nameDebounceRef.current = setTimeout(() => {
				if (value.trim() && id) {
					saveFnRef.current(id, {
						...editStateRef.current,
						name: value,
					});
				}
			}, 500);
		},
		[selectedId],
	);

	const handleIconChange = useCallback(
		(iconName: string) => {
			setEditIcon(iconName);
			editStateRef.current.icon = iconName;
			// Clear pending name debounce, this save includes current name
			if (nameDebounceRef.current) {
				clearTimeout(nameDebounceRef.current);
				nameDebounceRef.current = undefined;
			}
			if (selectedId) {
				saveFnRef.current(selectedId, {
					...editStateRef.current,
					icon: iconName,
				});
			}
		},
		[selectedId],
	);

	const handleColorChange = useCallback(
		(color: CategoryColor) => {
			setEditColor(color);
			editStateRef.current.color = color;
			if (nameDebounceRef.current) {
				clearTimeout(nameDebounceRef.current);
				nameDebounceRef.current = undefined;
			}
			if (selectedId) {
				saveFnRef.current(selectedId, {
					...editStateRef.current,
					color,
				});
			}
		},
		[selectedId],
	);

	const handleExcludeChange = useCallback(
		(value: boolean) => {
			setEditExclude(value);
			editStateRef.current.excludeByDefault = value;
			if (nameDebounceRef.current) {
				clearTimeout(nameDebounceRef.current);
				nameDebounceRef.current = undefined;
			}
			if (selectedId) {
				saveFnRef.current(selectedId, {
					...editStateRef.current,
					excludeByDefault: value,
				});
			}
		},
		[selectedId],
	);

	// --- Add category ---
	const handleAddCategory = useCallback(async () => {
		flushPendingSave();
		const usedNames = new Set(
			categories?.map((c) => c.name.toLowerCase()) ?? [],
		);
		let name = t("newCategory");
		let counter = 2;
		while (usedNames.has(name.toLowerCase())) {
			name = t("newCategoryN", { n: counter });
			counter++;
		}
		const usedColors = new Set(categories?.map((c) => c.color) ?? []);
		const color =
			PICKER_COLORS.find((c) => !usedColors.has(c)) ?? PICKER_COLORS[0]!;

		try {
			const created = await createMutation.mutateAsync({
				name,
				color,
				icon: "Tag",
			});
			const result = await refetchCategories();
			const newCat = result.data?.find(
				(c: { id: string }) => c.id === created.id,
			);
			setSelectedId(created.id);
			if (newCat) syncEditor(newCat);
			setMobileView("detail");
			setTimeout(() => {
				nameInputRef.current?.focus();
				nameInputRef.current?.select();
			}, 100);
		} catch (err) {
			toast.failed(
				err instanceof Error ? err.message : t("failedToCreateCategory"),
			);
		}
	}, [
		flushPendingSave,
		categories,
		createMutation,
		refetchCategories,
		syncEditor,
	]);

	// The opening intent runs once per open, after the selection settles.
	const intentDone = useRef(false);
	useEffect(() => {
		if (!open) {
			intentDone.current = false;
			return;
		}
		if (intentDone.current || !intent || !categories) return;
		if (intent === "add") {
			intentDone.current = true;
			void handleAddCategory();
		} else if (selectedId && selectedId === initialCategoryId) {
			intentDone.current = true;
			setRemoving(true);
		}
	}, [
		open,
		intent,
		categories,
		selectedId,
		initialCategoryId,
		handleAddCategory,
	]);

	// --- Delete category (the sheet commits it; the selection moves off it) ---
	const handleRemoved = useCallback(
		async (id: string) => {
			const result = await refetchCategories();
			const next = result.data?.find((c: { id: string }) => c.id !== id);
			setSelectedId(next?.id ?? null);
			if (next) syncEditor(next);
			setMobileView("list");
		},
		[refetchCategories, syncEditor],
	);

	// Always include current color in picker if it's not in the reduced set
	const displayColors = PICKER_COLORS.includes(editColor)
		? PICKER_COLORS
		: [editColor, ...PICKER_COLORS];

	return {
		t,
		selectedId,
		mobileView,
		setMobileView,
		saveStatus,
		categories,
		createMutation,
		selectedCategory,
		editName,
		editIcon,
		editColor,
		editExclude,
		nameInputRef,
		removing,
		setRemoving,
		displayName,
		handleNameChange,
		handleIconChange,
		handleColorChange,
		handleExcludeChange,
		handleRemoved,
		handleAddCategory,
		handleOpenChange,
		handleSelectCategory,
		displayColors,
	};
}

"use client";

import { ChevronDown, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ActionMenu } from "~/components/actions/action-menu";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useCategoryName } from "~/hooks/use-category-name";
import { categoryTone } from "~/lib/category-tone";
import { api, type RouterOutputs } from "~/trpc/react";
import { useAutosave } from "../autosave";
import { SectionShell, SectionUnavailable } from "../section-shell";
import { CategoryManager } from "./category-manager";

type Category = RouterOutputs["categories"]["getAll"][number];
type Manager = { id: string | null; intent: "add" | "delete" | null } | null;

/** How many rows show before "Show all". */
const FIRST = 8;

/**
 * Categories (N47): every category as a row with its tile, how many
 * expenses use it and whether new ones are left out of totals. A row opens
 * the manager on it (name, icon, color, delete with a move); its menu
 * toggles the default with Undo. Add category opens the manager's add form;
 * so does arriving with ?add=category (the palette command), once: the
 * param is dropped from the URL, so a reload does not add again.
 */
export function CategoriesSection() {
	const t = useTranslations("settingsV2.categories");
	const { data, isLoading, isError, refetch } =
		api.categories.getAll.useQuery();
	const [all, setAll] = useState(false);
	const [manager, setManager] = useState<Manager>(null);
	const router = useRouter();
	const pathname = usePathname();

	useEffect(() => {
		const qs = new URLSearchParams(window.location.search);
		if (qs.get("add") !== "category") return;
		setManager({ id: null, intent: "add" });
		qs.delete("add");
		const rest = qs.toString();
		router.replace(
			`${pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
			{ scroll: false },
		);
	}, [router, pathname]);

	const list = data ?? [];
	const shown = all ? list : list.slice(0, FIRST);
	const add = (
		<Button
			kind="secondary"
			onClick={() => setManager({ id: null, intent: "add" })}
			size="sm"
		>
			<Plus aria-hidden="true" />
			{t("add")}
		</Button>
	);

	return (
		<SectionShell action={add} id="categories" title={t("title")}>
			{isLoading ? (
				<SkeletonRows count={4} />
			) : isError ? (
				<SectionUnavailable onRetry={() => void refetch()} />
			) : list.length === 0 ? (
				<Empty title={t("empty")} />
			) : (
				<>
					<RowList label={t("title")}>
						{shown.map((c) => (
							<CategoryRow
								category={c}
								key={c.id}
								onOpen={(intent) => setManager({ id: c.id, intent })}
							/>
						))}
					</RowList>
					{!all && list.length > FIRST && (
						<Button
							className="mt-2"
							kind="ghost"
							onClick={() => setAll(true)}
							size="sm"
						>
							{t("showAll", { count: list.length })}
							<ChevronDown aria-hidden="true" />
						</Button>
					)}
				</>
			)}
			<CategoryManager
				initialCategoryId={manager?.id ?? null}
				intent={manager?.intent ?? null}
				onOpenChange={(open) => {
					if (!open) setManager(null);
				}}
				open={manager != null}
			/>
		</SectionShell>
	);
}

function CategoryRow({
	category: c,
	onOpen,
}: {
	category: Category;
	onOpen: (intent: "delete" | null) => void;
}) {
	const t = useTranslations("settingsV2.categories");
	const { displayName } = useCategoryName();
	const save = useAutosave();
	const utils = api.useUtils();
	const update = api.categories.update.useMutation();
	const name = displayName(c.name);
	const count = c._count.expenses;

	const setExcluded = (excludeByDefault: boolean) =>
		void save({
			apply: async (v: boolean) => {
				await update.mutateAsync({
					id: c.id,
					name: c.name,
					color: c.color,
					icon: c.icon ?? undefined,
					excludeByDefault: v,
				});
				await utils.categories.getAll.invalidate();
			},
			next: excludeByDefault,
			prev: c.excludeByDefault,
			message: excludeByDefault
				? t("excludedSaved", { name })
				: t("includedSaved", { name }),
		});

	const target = { id: c.id, name, excluded: c.excludeByDefault };
	const handlers = {
		edit: () => onOpen(null),
		exclude: () => setExcluded(true),
		include: () => setExcluded(false),
		delete: () => onOpen("delete"),
	};

	return (
		<Row
			actions={
				<ActionMenu entity="category" handlers={handlers} target={target} />
			}
			lead={
				<CategoryTile
					category={{ name: c.name, icon: c.icon, tone: categoryTone(c.color) }}
				/>
			}
			open={{ label: t("open", { name }), onOpen: () => onOpen(null) }}
			sub={
				<RowSub
					parts={[
						count > 0 ? t("entries", { count }) : t("noEntries"),
						c.excludeByDefault && t("excluded"),
					]}
				/>
			}
			title={name}
		/>
	);
}

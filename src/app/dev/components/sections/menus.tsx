"use client";

import {
	Banknote,
	Check,
	Copy,
	Eye,
	FolderInput,
	Pencil,
	Split,
	Tag,
	Trash2,
} from "lucide-react";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import { SwipeActions } from "~/components/actions/swipe-actions";
import { CategoryGlyph } from "~/components/pickers/category-picker";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import { Face } from "~/components/ui/avatar-face";
import { CategoryTile } from "~/components/ui/category-badge";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Row } from "~/components/rows/row";
import { seriesColor } from "~/components/charts/spec";
import { FixtureCover } from "../fixtures/covers";
import { CAT, P, PHONE_ROWS } from "../fixtures/rows";
import { CAP } from "../sections";
import { Cap, Pair, Spec, States } from "../spec";
import { ACTION_IDS, useDemoHandlers } from "./demo";
import { StaticMenu, type StaticMenuEntry } from "./static-menu";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	rows: "List rows keep the tile",
	chips: "Chips: text only",
	menuCap:
		"Menu (static), from the expense registry. Right-click a table row above, or press a three-dot button.",
	live: "The live three-dot button",
	press:
		"iPhone: long press a row, or drag it left and right. Every swipe has a menu twin.",
	danger: "Danger item",
	disabled: "Disabled item",
	mixed: "Menu with identity: bare category glyph, face, cover, group dot",
	expense: "Super Norte",
	label: "Example menu",
	review: "Mark as reviewed",
	open: "Open",
	edit: "Edit",
	split: "Split",
	category: "Change category",
	project: "Move to project",
	duplicate: "Duplicate",
	del: "Delete",
	settleAll: "Settle all",
	cat: "Category",
	person: "Person",
	proj: "Project",
	account: "Account",
	palermo: "Depto Palermo",
	floripa: "Viaje a Florianópolis",
	cash: "Cash (USD)",
	savings: "Savings account",
	btc: "Bitcoin",
};

const EXPENSE_MENU: StaticMenuEntry[] = [
	{ label: S.review, icon: Check },
	{ label: S.open, icon: Eye },
	{ label: S.edit, icon: Pencil, kbd: "E" },
	{ label: S.split, icon: Split },
	{ label: S.category, icon: Tag },
	{ label: S.project, icon: FolderInput },
	{ label: S.duplicate, icon: Copy },
	{ sep: true },
	{ label: S.del, icon: Trash2, danger: true },
];

const glyph = (c: (typeof CAT)[keyof typeof CAT], id: string) => (
	<CategoryGlyph category={{ id, ...c }} />
);
const cover = (scene: string) => (
	<span className="rounded-ctl size-5 shrink-0 overflow-hidden *:size-full">
		<FixtureCover scene={scene} />
	</span>
);
const dot = (series: number) => (
	<span
		aria-hidden="true"
		className="rounded-chip mx-2 inline-block size-2"
		style={{ background: seriesColor(series) }}
	/>
);

const MIXED: StaticMenuEntry[] = [
	{ group: S.cat },
	...[CAT.groceries, CAT.restaurants, CAT.transport].map((c) => ({
		label: c.name,
		lead: glyph(c, c.name),
	})),
	{ sep: true },
	{ group: S.person },
	...[P.lucia, P.martin, P.paz].map((p) => ({
		label: p.name.split(" ")[0] ?? p.name,
		lead: <Face name={p.name} size="xs" />,
	})),
	{ sep: true },
	{ group: S.proj },
	{ label: S.floripa, lead: cover("sea") },
	{ label: S.palermo, lead: cover("city") },
	{ sep: true },
	{ group: S.account },
	{ label: S.savings, lead: dot(2) },
	{ label: S.cash, lead: dot(2) },
	{ label: S.btc, lead: dot(4) },
];

export function IdentitySection() {
	return (
		<Spec id="identity">
			<Pair
				desktop={
					<>
						<Cap>{S.mixed}</Cap>
						<StaticMenu entries={MIXED} height={540} label={S.label} />
					</>
				}
				phone={
					<>
						<Cap>{S.rows}</Cap>
						<RowList variant="group">
							{[CAT.groceries, CAT.restaurants, CAT.transport].map((c) => (
								<Row
									key={c.name}
									lead={<CategoryTile category={c} />}
									title={c.name}
								/>
							))}
						</RowList>
						<Cap className="mt-4">{S.chips}</Cap>
						<FilterChips label={S.chips}>
							<FilterChip selected>{CAT.groceries.name}</FilterChip>
							<FilterChip>{CAT.restaurants.name}</FilterChip>
							<FilterChip>{CAT.transport.name}</FilterChip>
						</FilterChips>
					</>
				}
			/>
		</Spec>
	);
}

/** A phone row that answers long press and swipe from the expense registry. */
function PressRow({ index }: { index: number }) {
	const handlers = useDemoHandlers<ExpenseTarget>(ACTION_IDS.expense);
	const tx = PHONE_ROWS[index];
	if (!tx) return null;
	const target: ExpenseTarget = {
		id: tx.id,
		name: tx.title,
		mine: true,
		locked: false,
		reviewed: tx.reviewed,
		shared: false,
	};
	return (
		<SwipeActions entity="expense" handlers={handlers} swipe target={target}>
			<TransactionRow tx={tx} />
		</SwipeActions>
	);
}

export function MenuSection() {
	const handlers = useDemoHandlers<ExpenseTarget>(ACTION_IDS.expense);
	const target: ExpenseTarget = {
		id: "t6",
		name: S.expense,
		mine: true,
		locked: false,
		reviewed: false,
		shared: false,
	};
	return (
		<Spec id="menu">
			<Pair
				desktop={
					<>
						<Cap>{S.menuCap}</Cap>
						<StaticMenu entries={EXPENSE_MENU} height={330} label={S.label} />
						<Cap className="mt-2">{S.live}</Cap>
						<ActionMenu
							align="start"
							entity="expense"
							handlers={handlers}
							target={target}
						/>
					</>
				}
				desktopCap={CAP.desktop}
				phone={
					<>
						<Cap>{S.press}</Cap>
						<RowList variant="group">
							<PressRow index={0} />
							<PressRow index={2} />
						</RowList>
					</>
				}
				phoneCap={CAP.iphone}
			/>
			<States
				className="mt-4"
				items={[
					[
						S.danger,
						<StaticMenu
							entries={[{ label: S.del, icon: Trash2, danger: true }]}
							height={48}
							key="d"
							label={S.danger}
						/>,
					],
					[
						S.disabled,
						<StaticMenu
							entries={[{ label: S.settleAll, icon: Banknote, disabled: true }]}
							height={48}
							key="x"
							label={S.disabled}
						/>,
					],
				]}
			/>
		</Spec>
	);
}

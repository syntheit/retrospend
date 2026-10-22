"use client";

import { money, toMinor } from "@retrospend/domain/money-minor";
import {
	ArrowUpDown,
	CornerDownLeft,
	Keyboard,
	MessageSquare,
	Receipt,
	Repeat,
	Tags,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { Money } from "~/components/money/money";
import { ProjectVisual } from "~/components/project/project-visual";
import { useRecurringModal } from "~/components/recurring-modal-provider";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "~/components/ui/command";
import { ADD_ACTIONS, projectHref, settingsHref } from "~/lib/nav";
import { api } from "~/trpc/react";
import { goToItems, RECENT_EXPENSES, RECENT_PROJECTS } from "./palette-items";
import { useShellActions } from "./shell-context";
import { usePinnedProjects } from "./sidebar";

const ITEM =
	"h-10 gap-3 rounded-ctl px-3 py-0! text-body text-fg data-[selected=true]:bg-raised data-[selected=true]:text-fg";
const GROUP =
	"p-0 text-fg [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:text-meta";

function Item({
	value,
	lead,
	label,
	small,
	disabled,
	onSelect,
}: {
	value: string;
	lead: ReactNode;
	label: string;
	small?: ReactNode;
	disabled?: boolean;
	onSelect: () => void;
}) {
	return (
		<CommandItem
			className={ITEM}
			disabled={disabled}
			onSelect={onSelect}
			value={value}
		>
			<span className="flex size-6 shrink-0 items-center justify-center text-fg-2 [&_svg]:size-4!">
				{lead}
			</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{small && <span className="shrink-0 text-fg-3 text-meta">{small}</span>}
		</CommandItem>
	);
}

/** An amount the list sent as a number, in minor units for the one formatter. */
function amountOf(amount: number, currency: string) {
	try {
		return money(toMinor(amount, currency), currency);
	} catch {
		return null;
	}
}

function RecentGroup({
	open,
	go,
	run,
}: {
	open: boolean;
	go: (href: string) => void;
	run: (fn: () => void) => () => void;
}) {
	const t = useTranslations("shell.palette");
	const { openExpense } = useExpenseModal();
	const projects = usePinnedProjects().slice(0, RECENT_PROJECTS);
	const { data } = api.expense.listFinalized.useQuery(undefined, {
		enabled: open,
	});
	const expenses = (data ?? []).slice(0, RECENT_EXPENSES);
	if (!projects.length && !expenses.length) return null;
	return (
		<CommandGroup className={GROUP} heading={t("recent")}>
			{projects.map((p) => (
				<Item
					key={p.id}
					label={p.name}
					lead={
						<ProjectVisual
							className="size-5 rounded-ctl"
							imagePath={p.imagePath}
							projectName={p.name}
							size="xs"
						/>
					}
					onSelect={() => go(projectHref(p.id))}
					small={t("project")}
					value={`recent project ${p.name}`}
				/>
			))}
			{expenses.map((e) => (
				<Item
					key={e.id}
					label={e.title}
					lead={<Receipt aria-hidden="true" />}
					onSelect={run(() => openExpense(e.id))}
					small={<Money value={amountOf(e.amount, e.currency)} />}
					value={`recent expense ${e.title}`}
				/>
			))}
		</CommandGroup>
	);
}

/**
 * The command palette (Cmd+K, account.html): Recent, Go to and Commands
 * from the one nav definition. Typed results for people, projects, accounts
 * and expenses, and the inline currency converter, are not built yet
 * (docs/ui/GAPS.md); the palette shows nothing in their place.
 */
export function ShellPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("shell");
	const router = useRouter();
	const actions = useShellActions();
	const { openNewRecurring } = useRecurringModal();
	const { data: flags } = api.system.getFeatureFlags.useQuery();
	const [search, setSearch] = useState("");
	const close = () => {
		onOpenChange(false);
		setSearch("");
	};
	const run = (fn: () => void) => () => {
		close();
		fn();
	};
	const go = (href: string) => {
		close();
		router.push(href);
	};
	const typed = search.trim().length > 0;

	return (
		<CommandDialog
			className="top-[14%] max-w-140 translate-y-0 gap-0 rounded-panel border-line bg-surface p-0 text-fg shadow-menu sm:max-w-140"
			description={t("palette.description")}
			loop
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
			open={open}
			showCloseButton={false}
			title={t("palette.title")}
		>
			<CommandInput
				className="h-12 text-body placeholder:text-fg-3"
				onValueChange={setSearch}
				placeholder={t("palette.placeholder")}
				value={search}
			/>
			<CommandList className="max-h-[min(60vh,28rem)] p-1">
				<CommandEmpty className="py-6 text-center text-fg-3 text-small">
					{t("palette.noResults")}
				</CommandEmpty>
				{!typed && <RecentGroup go={go} open={open} run={run} />}
				<CommandGroup className={GROUP} heading={t("palette.goTo")}>
					{goToItems(typed).map((item) => {
						const Icon = item.icon;
						const label = item.label.section
							? t(item.label.key, {
									section: t(`settingsSections.${item.label.section}`),
								})
							: t(item.label.key);
						return (
							<Item
								key={item.id}
								label={label}
								lead={<Icon aria-hidden="true" />}
								onSelect={() => go(item.href)}
								value={`go ${label}`}
							/>
						);
					})}
				</CommandGroup>
				<CommandGroup className={GROUP} heading={t("palette.commands")}>
					{ADD_ACTIONS.map((a) => {
						const Icon = a.icon;
						return (
							<Item
								disabled={!a.ready}
								key={a.id}
								label={t(`add.${a.id}`)}
								lead={<Icon aria-hidden="true" />}
								onSelect={run(() => actions.add(a.id))}
								small={a.ready ? a.key.toUpperCase() : t("add.comingSoon")}
								value={`command ${t(`add.${a.id}`)}`}
							/>
						);
					})}
					<Item
						label={t("palette.addRecurring")}
						lead={<Repeat aria-hidden="true" />}
						onSelect={run(openNewRecurring)}
						value={`command ${t("palette.addRecurring")}`}
					/>
					<Item
						label={t("palette.manageCategories")}
						lead={<Tags aria-hidden="true" />}
						onSelect={() => go(settingsHref("categories"))}
						value={`command ${t("palette.manageCategories")}`}
					/>
					{flags?.feedbackEnabled && (
						<Item
							label={t("account.sendFeedback")}
							lead={<MessageSquare aria-hidden="true" />}
							onSelect={run(actions.openFeedback)}
							value={`command ${t("account.sendFeedback")}`}
						/>
					)}
					<Item
						label={t("account.shortcuts")}
						lead={<Keyboard aria-hidden="true" />}
						onSelect={run(actions.openShortcuts)}
						small="?"
						value={`command ${t("account.shortcuts")}`}
					/>
				</CommandGroup>
			</CommandList>
			<div className="flex gap-4 border-line border-t px-4 py-2 text-fg-3 text-meta">
				<span className="flex items-center gap-1">
					<ArrowUpDown aria-hidden="true" className="size-3.5" />
					{t("palette.move")}
				</span>
				<span className="flex items-center gap-1">
					<CornerDownLeft aria-hidden="true" className="size-3.5" />
					{t("palette.openHint")}
				</span>
			</div>
		</CommandDialog>
	);
}

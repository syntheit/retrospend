"use client";

import {
	BookOpen,
	FileText,
	House,
	Keyboard,
	LogOut,
	Plus,
	Receipt,
	Settings,
	Shield,
	UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { AccountTrigger } from "~/components/shell/account-menu";
import { BottomNav, FloatingAdd } from "~/components/shell/bottom-nav";
import { BellButton } from "~/components/shell/notifications";
import { PALETTE_GROUP, PaletteItem } from "~/components/shell/palette";
import {
	type ShellActions,
	ShellActionsContext,
} from "~/components/shell/shell-context";
import { SidebarView } from "~/components/shell/sidebar";
import {
	Command,
	CommandGroup,
	CommandInput,
	CommandList,
} from "~/components/ui/command";
import { useToast } from "~/components/ui/toast";
import { FixtureCover } from "../fixtures/covers";
import { Cap, Phone, Spec } from "../spec";
import { StaticMenu, type StaticMenuEntry } from "./static-menu";

/** Sample copy and people: fixtures, like the numbers. */
const S = {
	sidebar: "Sidebar on fixtures (Viaje a Florianópolis is the current page)",
	menu: "Account menu (static)",
	palette: "Palette, empty query (static): Go to, Recent, Commands",
	phone: "Phone web: bottom bar and the floating Add (Activity current)",
	user: { name: "Sofía Reyes", username: "sofia", imageUrl: null },
	pinned: [
		["p1", "Viaje a Florianópolis", "sea"],
		["p2", "Depto Palermo", "city"],
	] as const,
	search: "Search pages and commands",
	goTo: "Go to",
	recent: "Recent",
	commands: "Commands",
	home: "Home",
	activity: "Activity",
	settings: "Settings",
	project: "Project",
	addExpense: "Add expense",
	shortcuts: "Keyboard shortcuts",
};

const MENU: StaticMenuEntry[] = [
	{ label: "Your profile", icon: UserRound },
	{ sep: true },
	{ label: "Settings", icon: Settings },
	{ sep: true },
	{ label: "Admin", icon: Shield },
	{ sep: true },
	{ label: "Docs", icon: BookOpen },
	{ label: "Release notes", icon: FileText },
	{ label: "Keyboard shortcuts", icon: Keyboard, kbd: "?" },
	{ sep: true },
	{ label: "Sign out", icon: LogOut },
	{ group: "Version 0.5.0" },
];

const cover = (scene: "sea" | "city") => (
	<span className="rounded-ctl size-4.5 shrink-0 overflow-hidden *:size-full">
		<FixtureCover scene={scene} />
	</span>
);

/** Shell actions for the gallery: each one answers with a toast. */
function useDemoShell(): ShellActions {
	const toast = useToast();
	return useMemo(() => {
		const say = (what: string) => () => toast.info(what);
		return {
			add: (id) => toast.info(`add: ${id}`),
			openPalette: say("openPalette"),
			openShortcuts: say("openShortcuts"),
			openAccountSheet: say("openAccountSheet"),
			openNotificationsSheet: say("openNotificationsSheet"),
			openFeedback: say("openFeedback"),
		};
	}, [toast]);
}

function StaticPalette() {
	const noop = () => {};
	return (
		<Command className="rounded-panel border-line bg-surface text-fg w-full max-w-140 border">
			<CommandInput
				className="text-body placeholder:text-fg-3 h-12"
				placeholder={S.search}
				readOnly
			/>
			<CommandList className="max-h-none p-1">
				<CommandGroup className={PALETTE_GROUP} heading={S.goTo}>
					<PaletteItem
						label={S.home}
						lead={<House aria-hidden="true" />}
						onSelect={noop}
						value="go home"
					/>
					<PaletteItem
						label={S.activity}
						lead={<Receipt aria-hidden="true" />}
						onSelect={noop}
						value="go activity"
					/>
					<PaletteItem
						label={S.settings}
						lead={<Settings aria-hidden="true" />}
						onSelect={noop}
						value="go settings"
					/>
				</CommandGroup>
				<CommandGroup className={PALETTE_GROUP} heading={S.recent}>
					<PaletteItem
						label={S.pinned[0][1]}
						lead={cover("sea")}
						onSelect={noop}
						small={S.project}
						value="recent p1"
					/>
				</CommandGroup>
				<CommandGroup className={PALETTE_GROUP} heading={S.commands}>
					<PaletteItem
						label={S.addExpense}
						lead={<Plus aria-hidden="true" />}
						onSelect={noop}
						small="N"
						value="command expense"
					/>
					<PaletteItem
						label={S.shortcuts}
						lead={<Keyboard aria-hidden="true" />}
						onSelect={noop}
						small="?"
						value="command shortcuts"
					/>
				</CommandGroup>
			</CommandList>
		</Command>
	);
}

/** Sidebar, AccountMenu and Palette: the real shell parts on fixtures. */
export function ShellSection() {
	const actions = useDemoShell();
	const pinned = S.pinned.map(([id, name, scene]) => ({
		id,
		name,
		lead: cover(scene),
	}));
	return (
		<ShellActionsContext value={actions}>
			<Spec id="shell">
				<div className="flex flex-wrap items-start gap-8">
					<div>
						<Cap>{S.sidebar}</Cap>
						<SidebarView
							account={<AccountTrigger user={S.user} />}
							badges={{ activity: 7, budget: 3, people: 5 }}
							bell={<BellButton count={4} />}
							className="rounded-panel border-line h-160 border"
							pathname="/projects/p1"
							pinned={pinned}
						/>
					</div>
					<div>
						<Cap>{S.menu}</Cap>
						<StaticMenu entries={MENU} height={430} label={S.menu} />
					</div>
					<div className="min-w-80 flex-1">
						<Cap>{S.palette}</Cap>
						<StaticPalette />
					</div>
				</div>
			</Spec>
			<Spec id="bottomnav">
				<Cap>{S.phone}</Cap>
				<Phone className="h-60 overflow-hidden p-0">
					<FloatingAdd className="absolute bottom-20" />
					<BottomNav
						badges={{ activity: 7, people: 5 }}
						className="absolute"
						path="/transactions"
					/>
				</Phone>
			</Spec>
		</ShellActionsContext>
	);
}

import { type FloatingTab, type FloatingTabBarProps } from "./FloatingTabBar";
import { scrollFocusedToTop } from "./scrollToTop";
import { SideNav } from "./SideNav";

type Props = Pick<FloatingTabBarProps, "state" | "emitter" | "navigateToTab"> & {
	items: readonly FloatingTab[];
	footer: readonly FloatingTab[];
	variant: "sidebar" | "rail";
};

/**
 * The Android tablet navigation over the JS tab navigator: SideNav drawn as
 * the navigator's left bar. The tab press goes through the navigator's
 * emitter exactly as the phone bar's does, so a press on the open
 * destination pops its stack to the root, and at the root scrolls to the top.
 */
export function TabletNav({
	state,
	emitter,
	navigateToTab,
	items,
	footer,
	variant,
}: Props) {
	const focused = state.routes[state.index];
	return (
		<SideNav
			footerItems={footer}
			items={items}
			onSelect={(name) => {
				const route = state.routes.find((r) => r.name === name);
				if (!route) return;
				const event = emitter.emit({
					type: "tabPress",
					target: route.key,
					canPreventDefault: true,
				});
				if (event?.defaultPrevented) return;
				if (route.key !== focused?.key) navigateToTab(route.key);
				else if ((route.state?.index ?? 0) === 0) scrollFocusedToTop();
			}}
			selected={focused?.name}
			variant={variant}
		/>
	);
}

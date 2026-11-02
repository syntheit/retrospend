import type { ProjectTarget } from "~/components/actions/registry";

/** What a pinned project's menu needs from `project.list`; pinned projects are active. */
export function sidebarTarget(p: {
	id: string;
	name: string;
	myRole: string | null;
	_count: { participants: number };
}): ProjectTarget & { archived: boolean; owner: boolean; editor: boolean } {
	return {
		id: p.id,
		name: p.name,
		solo: p._count.participants <= 1,
		archived: false,
		owner: p.myRole === "ORGANIZER",
		editor: p.myRole === "ORGANIZER" || p.myRole === "EDITOR",
	};
}

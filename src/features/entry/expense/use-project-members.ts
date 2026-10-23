"use client";

import { useEffect, useMemo, useRef } from "react";
import { getImageUrl } from "~/lib/image-url";
import { api } from "~/trpc/react";
import type { EntryPerson } from "../types";
import type { Project } from "./expense-fields";
import type { useExpenseDraft } from "./use-expense-draft";

/**
 * A project's people come from entry.projectMembers: everyone who is a
 * member on the expense's day, never the project list's first few (those
 * are only for faces). Picking a project waits for the full list so the
 * split starts with everyone; a sheet opened from a project gets them once
 * they load.
 */
export function useProjectMembers(x: ReturnType<typeof useExpenseDraft>) {
	const { d, setProject } = x;
	const utils = api.useUtils();
	const query = api.entry.projectMembers.useQuery(
		{ projectId: d.projectId ?? "", date: d.date },
		{ enabled: !!d.projectId },
	);
	const seeded = useRef(false);
	const members: readonly EntryPerson[] | null = d.projectId
		? (query.data ?? null)
		: null;

	useEffect(() => {
		if (seeded.current || !members || !d.projectId) return;
		seeded.current = true;
		// Opened from a project with nobody on the split yet: everyone the rule includes.
		if (d.editing === null && d.others.length === 0)
			setProject(d.projectId, members);
	}, [members, d.projectId, d.editing, d.others.length, setProject]);

	const pick = async (project: Project | null) => {
		seeded.current = true;
		if (!project) return setProject(null, []);
		const people = await utils.entry.projectMembers.fetch({
			projectId: project.id,
			date: d.date,
		});
		setProject(project.id, people, project.primaryCurrency);
	};
	return { members, pick };
}

/** Projects you can add into, with their first few people for faces (you left out). */
export function useProjects(youId: string): Project[] {
	const { data } = api.project.list.useQuery({ status: "ACTIVE" });
	return useMemo(
		() =>
			(data ?? [])
				.filter((p) => p.myRole !== "VIEWER")
				.map((p) => ({
					id: p.id,
					name: p.name,
					coverUrl: getImageUrl(p.imagePath),
					primaryCurrency: p.primaryCurrency,
					members: p.participants
						.filter(
							(m) =>
								!(m.participantType === "user" && m.participantId === youId),
						)
						.map((m) => ({
							participantType: m.participantType,
							participantId: m.participantId,
							name: m.name,
							avatarUrl: m.avatarUrl ?? null,
						})),
				})),
		[data, youId],
	);
}

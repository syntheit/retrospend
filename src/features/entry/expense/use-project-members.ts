"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { useToast } from "~/components/ui/toast";
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
	const { d, set, setProject } = x;
	const t = useTranslations("entry.expense");
	const toast = useToast();
	const utils = api.useUtils();
	// Each pick has a number: an older pick's late answer is dropped.
	const picks = useRef(0);
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
		// Opened from a project with nobody on the split yet: everyone the rule
		// includes, without touching You, Spread or Exclude.
		if (d.editing === null && d.others.length === 0) set({ others: members });
	}, [members, d.projectId, d.editing, d.others.length, set]);

	const pick = async (project: Project | null) => {
		seeded.current = true;
		const n = ++picks.current;
		if (!project) return setProject(null, []);
		try {
			const people = await utils.entry.projectMembers.fetch({
				projectId: project.id,
				date: d.date,
			});
			if (n === picks.current)
				setProject(project.id, people, project.primaryCurrency);
		} catch {
			// The project stays unpicked: a split without its people would be wrong.
			if (n === picks.current) toast.failed(t("error.projectMembers"));
		}
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
					peopleCount: p._count.participants,
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

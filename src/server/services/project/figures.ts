/**
 * The project summary's figures (IMPLEMENTATION §2.4). Read for one user,
 * narrowed to a project, optionally to one of its billing periods
 * (`periodId`: the period's expenses and the payments recorded against it),
 * and, for member figures, to one person
 * (`personId` = `<participantType>:<participantId>`, as summary.refKey).
 * Every value is a per-currency list in minor units; nothing is converted.
 */
import type {
	FigureDb,
	FigureDefinition,
	FigureScope,
	Money,
} from "~/server/figures/registry";
import { readProjectNumbers } from "./numbers";
import type { MemberLine } from "./summary";

function projectOf(scope: FigureScope): string {
	if (!scope.projectId) {
		throw new Error("a project figure needs a projectId narrowing");
	}
	return scope.projectId;
}

const numbersFor = (db: FigureDb, scope: FigureScope) =>
	readProjectNumbers(
		db,
		projectOf(scope),
		{ participantType: "user", participantId: scope.userId },
		scope.periodId,
	);

/** Group total: every expense in the project (or the period), per currency. */
const projectTotal: FigureDefinition = {
	id: "project.total",
	scope: ["projectId", "periodId"],
	compute: async (db, scope) => (await numbersFor(db, scope)).total,
};

function memberFigure(
	field: Exclude<keyof MemberLine, "currency">,
): FigureDefinition {
	return {
		id: `project.member.${field}`,
		scope: ["projectId", "personId", "periodId"],
		compute: async (db, scope) => {
			if (!scope.personId) {
				throw new Error(`project.member.${field} needs a personId narrowing`);
			}
			const member = (await numbersFor(db, scope)).members.find(
				(m) => m.key === scope.personId,
			);
			return (member?.lines ?? []).map(
				(line): Money => ({ minor: line[field], currency: line.currency }),
			);
		},
	};
}

export const projectFigures: readonly FigureDefinition[] = [
	projectTotal,
	memberFigure("paid"),
	memberFigure("share"),
	memberFigure("received"),
	memberFigure("sent"),
	memberFigure("balance"),
];

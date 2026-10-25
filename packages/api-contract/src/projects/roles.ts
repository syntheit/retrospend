import * as z from "zod";

export const PROJECT_ROLES = [
	"ORGANIZER",
	"EDITOR",
	"CONTRIBUTOR",
	"VIEWER",
] as const;

export const projectRoleSchema = z
	.enum(PROJECT_ROLES)
	.meta({ id: "ProjectRole" });

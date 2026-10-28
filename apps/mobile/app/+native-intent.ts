import { systemPath } from "@/surfaces/links";

/** Maps incoming links to routes; see src/surfaces/links.ts. */
export function redirectSystemPath({
	path,
}: {
	path: string;
	initial: boolean;
}) {
	return systemPath(path);
}

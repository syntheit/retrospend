import { appleAppSiteAssociation, jsonFile } from "~/lib/app-links";

export function GET() {
	return jsonFile(appleAppSiteAssociation());
}

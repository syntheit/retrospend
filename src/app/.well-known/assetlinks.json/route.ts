import { env } from "~/env";
import { assetLinks, jsonFile } from "~/lib/app-links";

export function GET() {
	return jsonFile(assetLinks(env.ANDROID_APP_CERT_SHA256));
}

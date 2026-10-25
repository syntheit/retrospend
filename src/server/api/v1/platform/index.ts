import {
	getMe,
	getServerInfo,
} from "~/server/services/api-v1/platform.service";
import { signedIn, v1 } from "../middleware";

export const platformRouter = {
	serverInfo: v1.platform.serverInfo.handler(() => getServerInfo()),
	me: v1.platform.me.handler(({ context }) => {
		const user = signedIn(context);
		return getMe(user.db, user.principal);
	}),
};

/**
 * The component gallery (retrospend://gallery) is a development screen. It is
 * on in dev builds and in any build made with EXPO_PUBLIC_GALLERY=1, which is
 * how the simulator screenshots are taken. Release builds leave it out.
 */
export const GALLERY_ENABLED =
	__DEV__ || process.env.EXPO_PUBLIC_GALLERY === "1";

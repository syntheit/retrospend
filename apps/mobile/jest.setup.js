// Reanimated and worklets have no native half in tests, and their own mock
// loads the native initializers, so a small stand-in covers what the app
// uses: animated views are plain views, shared values are plain boxes, and
// every animation lands at its end at once.
jest.mock("react-native-worklets", () => ({
	scheduleOnRN: (fn, ...args) => fn(...args),
	scheduleOnUI: (fn, ...args) => fn(...args),
}));

jest.mock("react-native-reanimated", () => {
	const React = require("react");
	const { View, Text, ScrollView, FlatList, Image } = require("react-native");
	const strip = (Component) =>
		React.forwardRef(({ entering, exiting, layout, ...props }, ref) =>
			React.createElement(Component, { ...props, ref }),
		);
	const builder = () => {
		const b = {};
		for (const name of [
			"duration",
			"easing",
			"delay",
			"reduceMotion",
			"withCallback",
			"springify",
		]) {
			b[name] = () => b;
		}
		return b;
	};
	const animations = {};
	for (const name of [
		"FadeIn",
		"FadeOut",
		"FadeInLeft",
		"FadeInRight",
		"FadeOutLeft",
		"FadeOutRight",
		"LinearTransition",
	]) {
		animations[name] = builder();
	}
	const AnimatedView = strip(View);
	const Animated = {
		View: AnimatedView,
		Text: strip(Text),
		ScrollView: strip(ScrollView),
		FlatList: strip(FlatList),
		Image: strip(Image),
		createAnimatedComponent: strip,
	};
	const identity = (t) => t;
	return {
		__esModule: true,
		default: Animated,
		...Animated,
		...animations,
		LayoutAnimationConfig: ({ children }) => children,
		ReduceMotion: { System: "system", Always: "always", Never: "never" },
		Easing: {
			bezier: () => identity,
			linear: identity,
			ease: identity,
			inOut: () => identity,
			in: () => identity,
			out: () => identity,
		},
		useSharedValue: (value) => React.useRef({ value }).current,
		useAnimatedStyle: (fn) => fn(),
		useDerivedValue: (fn) => ({ value: fn() }),
		useAnimatedReaction: () => {},
		useAnimatedRef: () => ({ current: null, observe: () => () => {} }),
		useScrollOffset: (_ref, offset) => offset ?? { value: 0 },
		Extrapolation: { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" },
		interpolate: (x, input, output) => {
			const t = (x - input[0]) / (input[1] - input[0]);
			return output[0] + Math.min(Math.max(t, 0), 1) * (output[1] - output[0]);
		},
		interpolateColor: (_x, _input, output) => output[0],
		useReducedMotion: () => false,
		isSharedValue: () => false,
		withTiming: (to, _config, done) => {
			done?.(true);
			return to;
		},
		withSpring: (to) => to,
		withDelay: (_ms, animation) => animation,
		withRepeat: (animation) => animation,
		withSequence: (...animations) => animations[animations.length - 1],
		cancelAnimation: () => {},
		runOnJS: (fn) => fn,
		runOnUI: (fn) => fn,
	};
});

require("react-native-gesture-handler/jestSetup");

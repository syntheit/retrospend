import tokens from "@retrospend/tokens/tokens.json";

/**
 * The design tokens an email uses. Email clients ignore CSS variables and
 * stylesheets, so the light theme's resolved values are read from the
 * generated tokens file when the module loads and written inline by the
 * templates. Nothing here is a literal color or size: change a token, run
 * `pnpm ui:tokens`, and the emails follow.
 */
const light = tokens.light;

export const emailTheme = {
	color: {
		page: light["color.bg"],
		card: light["color.surface"],
		raised: light["color.raised"],
		line: light["color.line"],
		text: light["color.fg"],
		textSecondary: light["color.fg-2"],
		textMuted: light["color.fg-3"],
		brand: light["color.brand"],
		onBrand: light["color.brand-fg"],
		link: light["color.accent-strong"],
		attentionText: light["color.attention-text"],
		attentionBg: light["color.attention-bg"],
		danger: light["color.danger"],
		onDanger: light["color.danger-fg"],
	},
	font: {
		stack: `'${light["font.family.sans"]}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
		medium: light["font.weight.medium"],
		semibold: light["font.weight.semibold"],
	},
	type: {
		title: {
			size: light["type.title.size"],
			lineHeight: light["type.title.line-height"],
			tracking: light["type.title.tracking"],
		},
		section: {
			size: light["type.section.size"],
			lineHeight: light["type.section.line-height"],
		},
		body: {
			size: light["type.body.size"],
			lineHeight: light["type.body.line-height"],
		},
		small: {
			size: light["type.small.size"],
			lineHeight: light["type.small.line-height"],
		},
		meta: {
			size: light["type.meta.size"],
			lineHeight: light["type.meta.line-height"],
		},
	},
	space: {
		1: light["space.1"],
		2: light["space.2"],
		3: light["space.3"],
		4: light["space.4"],
		6: light["space.6"],
		8: light["space.8"],
		12: light["space.12"],
	},
	radius: {
		control: light["radius.ctl"],
		panel: light["radius.panel"],
	},
} as const;

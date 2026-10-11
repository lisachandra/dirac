import { CardStatus } from "@shared/ExtensionMessage"

export enum TerminalColorMode {
	DARK = "dark",
	LIGHT = "light",
}

export enum TerminalColorPreference {
	AUTO = "auto",
	DARK = "dark",
	LIGHT = "light",
}

function isLightIndexedColor(index: number): boolean {
	if (index < 0 || index > 255) return false
	if (index < 16) return index === 7 || index === 15
	if (index >= 232) return 8 + (index - 232) * 10 >= 160

	const cubeIndex = index - 16
	const levels = [0, 95, 135, 175, 215, 255]
	const red = levels[Math.floor(cubeIndex / 36)]
	const green = levels[Math.floor((cubeIndex % 36) / 6)]
	const blue = levels[cubeIndex % 6]
	return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 >= 0.62
}

function detectColorFgBg(value: string | undefined): TerminalColorMode | null {
	const backgroundIndexText = value?.split(";").at(-1)?.trim()
	if (!backgroundIndexText || !/^\d+$/.test(backgroundIndexText)) return null
	return isLightIndexedColor(Number(backgroundIndexText)) ? TerminalColorMode.LIGHT : TerminalColorMode.DARK
}

/**
 * Resolve terminal colors without sending terminal queries. COLORFGBG is used
 * when the terminal provides it; otherwise the established dark palette wins.
 */
export function resolveTerminalColorMode(env: NodeJS.ProcessEnv = process.env, savedPreference?: string): TerminalColorMode {
	const environmentPreference = env.DIRAC_COLOR_MODE?.trim().toLowerCase()
	if (environmentPreference === TerminalColorPreference.LIGHT) return TerminalColorMode.LIGHT
	if (environmentPreference === TerminalColorPreference.DARK) return TerminalColorMode.DARK
	if (environmentPreference !== undefined) return detectColorFgBg(env.COLORFGBG) ?? TerminalColorMode.DARK
	if (savedPreference === TerminalColorPreference.LIGHT) return TerminalColorMode.LIGHT
	if (savedPreference === TerminalColorPreference.DARK) return TerminalColorMode.DARK

	return detectColorFgBg(env.COLORFGBG) ?? TerminalColorMode.DARK
}

export let terminalColorMode = resolveTerminalColorMode()

export function shouldUseAnsiColors(isTTY: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.NO_COLOR !== undefined || env.FORCE_COLOR === "0") return false
	if (env.FORCE_COLOR !== undefined) return true
	return isTTY
}

// Transcript styling rules:
// - role/category colors identify who or what produced an update;
// - status colors identify lifecycle state;
// - bold marks active or attention-required UI;
// - italic marks secondary annotations, never primary content.

const DARK_THEME = {
	primary: "#7FA9C8",
	plan: "#C8A96B",
	text: "#E7EAF0",
	strongText: "#F4F6FA",
	muted: "#9299AA",
	subtle: "#676E7D",
	transcriptText: "#D7DBE4",
	userMessage: "#73B98A",
	assistantMessage: "#D09A72",
	toolHeader: "#C2C8D3",
	toolBody: "#AAB2C0",
	toolMetadata: "#858D9D",
	success: "#73B98A",
	error: "#D97878",
	warning: "#C8A96B",
	info: "#70B7C4",
	link: "#78A7D6",
	magenta: "#B69ACB",
	codeText: "#A8C7DC",
	codeBg: "#222734",
	highlightBg: "#343A4C",
	highlightText: "#EDF0F5",
	selectionBg: "#30364A",
	selectionText: "#F4F6FA",
	cursorBg: "#C6CBDD",
	cursorText: "#1B1E27",
	inputMention: "#C4A7D5",
	inputCommand: "#AAB4E8",
	buttonText: "#F7F8FC",
	buttonPrimaryBg: "#4F587D",
	buttonPlanBg: "#665938",
	buttonPrimaryText: "#F4F6FA",
	buttonSecondaryBg: "#333947",
	buttonSecondaryText: "#E7EAF0",
	buttonDangerBg: "#75474B",
	buttonDangerText: "#F7EFF0",
	separator: "#555D6D",
	border: "#596273",
	toolRead: "#73A7BF",
	toolEdit: "#D09A72",
	toolSearch: "#8FA8D8",
	toolExecute: "#70AD85",
	toolInspect: "#6F9FC7",
	toolDiagnostic: "#B99A60",
	toolCommunicate: "#83A6B8",
	toolComplete: "#73B98A",
	diff: {
		addBg: "#102419",
		addFg: "#73B98A",
		removeBg: "#2B1719",
		removeFg: "#D97878",
		gutterFg: "#676E7D",
		contextFg: "#9AA2B1",
	},
} as const

const LIGHT_THEME = {
	primary: "#315F89",
	plan: "#805B17",
	text: "#2A2D33",
	strongText: "#17191E",
	muted: "#626975",
	subtle: "#7B818B",
	transcriptText: "#343840",
	userMessage: "#277440",
	assistantMessage: "#8A552E",
	toolHeader: "#414751",
	toolBody: "#555C67",
	toolMetadata: "#707781",
	success: "#277440",
	error: "#A83E38",
	warning: "#805B17",
	info: "#176F78",
	link: "#275D98",
	magenta: "#71457D",
	codeText: "#344E70",
	codeBg: "#E9EBF2",
	highlightBg: "#E1E4EF",
	highlightText: "#252A4A",
	selectionBg: "#E2E5F0",
	selectionText: "#252A4A",
	cursorBg: "#30364A",
	cursorText: "#FFFFFF",
	inputMention: "#6E4778",
	inputCommand: "#46538F",
	buttonText: "#FFFFFF",
	buttonPrimaryBg: "#59649A",
	buttonPlanBg: "#735B2C",
	buttonPrimaryText: "#FFFFFF",
	buttonSecondaryBg: "#D7DBE5",
	buttonSecondaryText: "#25282E",
	buttonDangerBg: "#9B4944",
	buttonDangerText: "#FFFFFF",
	separator: "#7B818B",
	border: "#7B818B",
	toolRead: "#286A82",
	toolEdit: "#8A552E",
	toolSearch: "#405F91",
	toolExecute: "#2F7045",
	toolInspect: "#315F89",
	toolDiagnostic: "#7B5B1F",
	toolCommunicate: "#356779",
	toolComplete: "#277440",
	diff: {
		addBg: "#E7F2E9",
		addFg: "#277440",
		removeBg: "#F7E7E5",
		removeFg: "#A83E38",
		gutterFg: "#7B818B",
		contextFg: "#5F6670",
	},
} as const

function createTheme(mode: TerminalColorMode) {
	const selectedTheme = mode === TerminalColorMode.LIGHT ? LIGHT_THEME : DARK_THEME
	return {
		...selectedTheme,
		status: {
			success: selectedTheme.success,
			error: selectedTheme.error,
			cancelled: selectedTheme.error,
			running: selectedTheme.link,
			waiting: selectedTheme.warning,
			building: selectedTheme.warning,
			pending: selectedTheme.warning,
			skipped: selectedTheme.muted,
			abandoned: selectedTheme.muted,
			default: selectedTheme.muted,
		},
		symbols: {
			active: "●",
			inactive: "○",
			success: "✓",
			failure: "×",
			warning: "!",
			collapsed: "▸",
			expanded: "▾",
			separator: "·",
		},
		dimText: selectedTheme.muted,
		costWarning: 1,
		costDanger: 5,
		contextWarning: 0.5,
		contextDanger: 0.8,
	}
}

function createColors(activeTheme: ReturnType<typeof createTheme>) {
	return {
		primary: activeTheme.primary,
		plan: activeTheme.plan,
		text: activeTheme.text,
		strongText: activeTheme.strongText,
		success: activeTheme.success,
		error: activeTheme.error,
		warning: activeTheme.warning,
		info: activeTheme.info,
		muted: activeTheme.muted,
		subtle: activeTheme.subtle,
		link: activeTheme.link,
		magenta: activeTheme.magenta,
		codeText: activeTheme.codeText,
		codeBg: activeTheme.codeBg,
	}
}

const ANSI_BASE = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	italic: "\x1b[3m",
	underline: "\x1b[4m",
	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	brightBlack: "\x1b[90m",
	brightRed: "\x1b[91m",
	brightGreen: "\x1b[92m",
	brightYellow: "\x1b[93m",
	brightBlue: "\x1b[94m",
	brightMagenta: "\x1b[95m",
	brightCyan: "\x1b[96m",
	brightWhite: "\x1b[97m",
	bgBlack: "\x1b[40m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
	bgMagenta: "\x1b[45m",
	bgCyan: "\x1b[46m",
	bgWhite: "\x1b[47m",
} as const

export function ansiForeground(hex: string): string {
	const [red, green, blue] = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((component) => Number.parseInt(component, 16))
	return `\x1b[38;2;${red};${green};${blue}m`
}

function ansiBackground(hex: string): string {
	const [red, green, blue] = hex
		.slice(1)
		.match(/.{2}/g)!
		.map((component) => Number.parseInt(component, 16))
	return `\x1b[48;2;${red};${green};${blue}m`
}

function createAnsi(mode: TerminalColorMode) {
	const selectedTheme = mode === TerminalColorMode.LIGHT ? LIGHT_THEME : DARK_THEME
	const compatibilityColors =
		mode === TerminalColorMode.LIGHT
			? {
					...ANSI_BASE,
					brightWhite: ANSI_BASE.black,
					brightCyan: ANSI_BASE.cyan,
					bgBlack: ANSI_BASE.bgWhite,
				}
			: { ...ANSI_BASE }

	return {
		...compatibilityColors,
		text: ansiForeground(selectedTheme.text),
		strongText: ansiForeground(selectedTheme.strongText),
		muted: ansiForeground(selectedTheme.muted),
		subtle: ansiForeground(selectedTheme.subtle),
		primary: ansiForeground(selectedTheme.primary),
		success: ansiForeground(selectedTheme.success),
		error: ansiForeground(selectedTheme.error),
		warning: ansiForeground(selectedTheme.warning),
		info: ansiForeground(selectedTheme.info),
		link: ansiForeground(selectedTheme.link),
		codeText: ansiForeground(selectedTheme.codeText),
		codeBackground: ansiBackground(selectedTheme.codeBg),
		transcriptText: ansiForeground(selectedTheme.transcriptText),
		toolHeader: ansiForeground(selectedTheme.toolHeader),
		toolBody: ansiForeground(selectedTheme.toolBody),
		toolMetadata: ansiForeground(selectedTheme.toolMetadata),
	}
}

function createStyles(activeTheme: ReturnType<typeof createTheme>) {
	return {
		markdown: {
			heading: { bold: true, color: activeTheme.strongText },
			headingSub: { bold: true, color: activeTheme.text },
			strong: { bold: true, color: activeTheme.strongText },
			emphasis: { italic: true },
			link: { color: activeTheme.link, underline: true },
			inlineCode: { color: activeTheme.codeText, backgroundColor: activeTheme.codeBg },
			codeBlock: { color: activeTheme.codeText },
			codeBorder: { color: activeTheme.subtle },
			blockquote: { color: activeTheme.muted },
			blockquoteBar: { color: activeTheme.subtle },
			tableBorder: { color: activeTheme.subtle },
			tableHeader: { bold: true, color: activeTheme.strongText },
			hr: { color: activeTheme.separator },
		},
		tool: {
			// Category colors are reserved for the icon and border. Text styling describes lifecycle and content role.
			header: { color: activeTheme.toolHeader },
			activeHeader: { color: activeTheme.toolHeader, bold: true },
			attentionHeader: { color: activeTheme.warning, bold: true },
			errorHeader: { color: activeTheme.error, bold: true },
			body: { color: activeTheme.toolBody },
			metadata: { color: activeTheme.toolMetadata },
			annotation: { color: activeTheme.toolMetadata, italic: true },
			attention: { color: activeTheme.warning, bold: true },
		},
		thinking: {
			shimmerDim: { color: activeTheme.muted, dimColor: true },
			shimmerBright: { color: activeTheme.text },
			elapsed: { color: activeTheme.muted },
			breadcrumb: { color: activeTheme.subtle },
		},
		conversation: {
			user: { color: activeTheme.userMessage },
			assistant: { color: activeTheme.assistantMessage },
			planModeTint: { color: activeTheme.plan },
			completion: { color: activeTheme.success, bold: true },
			divider: { color: activeTheme.separator },
			reasoning: { color: activeTheme.muted },
			reasoningTitle: { color: activeTheme.subtle },
			typeChangeSep: { color: activeTheme.separator },
		},
	}
}

export const theme = createTheme(terminalColorMode)
export const colors = createColors(theme)
export const ansi = createAnsi(terminalColorMode)
export const styles = createStyles(theme)

/** Configure the process-wide CLI palette after persisted settings are loaded. */
export function configureTerminalTheme(savedPreference?: string, env: NodeJS.ProcessEnv = process.env): TerminalColorMode {
	terminalColorMode = resolveTerminalColorMode(env, savedPreference)
	const nextTheme = createTheme(terminalColorMode)
	const existingStatus = theme.status
	const existingDiff = theme.diff
	Object.assign(existingStatus, nextTheme.status)
	Object.assign(existingDiff, nextTheme.diff)
	Object.assign(theme, nextTheme, { status: existingStatus, diff: existingDiff })
	Object.assign(colors, createColors(theme))
	Object.assign(ansi, createAnsi(terminalColorMode))

	const nextStyles = createStyles(theme)
	Object.assign(styles.markdown, nextStyles.markdown)
	Object.assign(styles.tool, nextStyles.tool)
	Object.assign(styles.thinking, nextStyles.thinking)
	Object.assign(styles.conversation, nextStyles.conversation)
	return terminalColorMode
}

export function statusAnsi(status: CardStatus): string {
	switch (status) {
		case CardStatus.SUCCESS:
			return ansi.success
		case CardStatus.ERROR:
		case CardStatus.CANCELLED:
			return ansi.error
		case CardStatus.RUNNING:
			return ansi.link
		case CardStatus.WAITING_FOR_INPUT:
			return ansi.warning
		case CardStatus.BUILDING:
		case CardStatus.PENDING:
			return ansi.warning
		case CardStatus.SKIPPED:
		case CardStatus.ABANDONED:
			return ansi.muted
	}
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SlashCommandInfo } from "@shared/proto/dirac/slash"
import { EmptyRequest } from "@shared/proto/dirac/common"
import { CLI_ONLY_COMMANDS } from "@shared/slashCommands"
import { getAvailableSlashCommands } from "@/core/controller/slash/getAvailableSlashCommands"
import { StateManager } from "@/core/storage/StateManager"
import { arePathsEqual } from "@/utils/path"
import { UIActionButtonType } from "@shared/ExtensionMessage"
import type { DiracAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"

import { useHomeEndKeys } from "./useHomeEndKeys"
import { useRawBackspaceKeys } from "./useRawBackspaceKeys"
import { useTextInput } from "./useTextInput"
import { useChatInputHandler } from "./useChatInputHandler"
import {
	checkAndWarnRipgrepMissing,
	extractMentionQuery,
	type FileSearchResult,
	searchWorkspaceFiles,
} from "../utils/file-search"
import { parseImagesFromInput } from "../utils/parser"
import { extractSlashQuery, filterCommands, mergeCliSlashCommands } from "../utils/slash-commands"
import { getInputStorageKey } from "../utils/chat"
import { CliPanelType } from "../types"
import type { GoalStatus } from "@shared/goal"
import type { GoalLifecycleAction } from "../utils/goals"

export type ActivePanel =
	| {
			type: CliPanelType.SETTINGS
			initialMode?: "model-picker" | "featured-models" | "provider-picker"
			initialModelKey?: "actModelId" | "planModelId"
	  }
	| { type: CliPanelType.HISTORY }
	| { type: CliPanelType.HELP }
	| { type: CliPanelType.SKILLS }
	| { type: CliPanelType.USAGE }
	| { type: CliPanelType.AGENTS }
	| null

interface PersistedInputState {
	text: string
	cursorPos: number
	pastedTexts: Map<number, string>
	pasteCounter: number
}

const inputStateStorage = new Map<string, PersistedInputState>()

const SEARCH_DEBOUNCE_MS = 150
const RIPGREP_WARNING_DURATION_MS = 5000
const MAX_SEARCH_RESULTS = 15
const PASTE_COLLAPSE_THRESHOLD = 10000
const PASTE_CHUNK_WINDOW_MS = 150
const PASTE_UPDATE_DEBOUNCE_MS = 50
const MAX_HISTORY_ITEMS = 20

export interface ComposerActions {
	handleAskShortcuts: (input: string, key: any, currentTextInput: string) => boolean
	handleSubmit: (text: string, images: string[]) => void
	handleExit: () => void
	clearViewAndResetTask: () => void
	handleButtonAction: (
		action: UIActionButtonType | string | DiracAskResponse | undefined,
		isPrimary: boolean,
		value?: string,
	) => void
	toggleMode: () => void
	toggleAutoApproveAll: () => void
	enableFastMode: () => void
	toggleQuietMode: () => void
}

interface UseComposerProps {
	ctrl: any
	taskId?: string
	mode: string
	workspacePath: string
	activePanel: ActivePanel
	setActivePanel: React.Dispatch<React.SetStateAction<ActivePanel>>
	isSpinnerActive: boolean
	isProcessing: boolean
	uiActionState: any
	yolo: boolean
	pendingAsk: any
	actionsRef: React.MutableRefObject<ComposerActions>
	isYoloSuppressed: (yolo: boolean, ask: any) => boolean
	isEmptyConversation: boolean
	scrollableCardMaxOffset: number
	cardScrollOffset: number
	setCardScrollOffset: (offset: number) => void
	goalStatus?: GoalStatus
	handleGoalControl: (action: GoalLifecycleAction) => void
	toggleGoalDetails: () => void
	disarmGoalStopConfirmation: () => void
}

export function useComposer({
	ctrl,
	taskId,
	mode,
	workspacePath,
	activePanel,
	setActivePanel,
	isSpinnerActive,
	isProcessing,
	uiActionState,
	yolo,
	pendingAsk,
	actionsRef,
	isYoloSuppressed,

	isEmptyConversation,
	scrollableCardMaxOffset,
	cardScrollOffset,
	setCardScrollOffset,
	goalStatus,
	handleGoalControl,
	toggleGoalDetails,
	disarmGoalStopConfirmation,
}: UseComposerProps) {
	const {
		text: textInput,
		cursorPos,
		setText: setTextInput,
		setCursorPos,
		handleKeyboardSequence,
		handleCtrlShortcut,
		deleteCharsBefore,
		deleteCharsAfter,
		insertText: insertTextAtCursor,
		getText,
		getCursorPos,
	} = useTextInput()

	const storageKey = useMemo(() => getInputStorageKey(ctrl, taskId), [ctrl, taskId])
	const textInputRef = useMemo(
		() => ({
			get current() {
				return getText()
			},
		}),
		[getText],
	)
	const cursorPosRef = useMemo(
		() => ({
			get current() {
				return getCursorPos()
			},
		}),
		[getCursorPos],
	)

	const [pastedTexts, setPastedTexts] = useState<Map<number, string>>(() => {
		return inputStateStorage.get(storageKey)?.pastedTexts ?? new Map()
	})
	const pasteCounterRef = useRef<number>(inputStateStorage.get(storageKey)?.pasteCounter ?? 0)
	const lastPasteTimeRef = useRef<number>(0)
	const activePasteNumRef = useRef<number>(0)
	const activePasteStartPosRef = useRef<number>(0)
	const activePasteLinesRef = useRef<number>(0)
	const pasteUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const ripgrepWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	const [fileResults, setFileResults] = useState<FileSearchResult[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [historyIndex, setHistoryIndex] = useState(-1)
	const [savedInput, setSavedInput] = useState("")
	const [isSearching, setIsSearching] = useState(false)
	const [fileSearchError, setFileSearchError] = useState<string | null>(null)
	const [showRipgrepWarning, setShowRipgrepWarning] = useState(false)

	const [availableCommands, setAvailableCommands] = useState<SlashCommandInfo[]>([])
	const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
	const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
	const lastSlashIndexRef = useRef<number>(-1)

	const searchRef = useRef({
		searchTimeout: null as NodeJS.Timeout | null,
		lastQuery: null as string | null,
		hasCheckedRipgrep: false,
		requestId: 0,
	})
	const skipNextPersistRef = useRef(false)

	const handleHome = useCallback(() => setCursorPos(0), [setCursorPos])
	const handleEnd = useCallback(() => setCursorPos(textInputRef.current.length), [setCursorPos, textInputRef])

	useHomeEndKeys({
		onHome: handleHome,
		onEnd: handleEnd,
		isActive: !activePanel,
	})

	useRawBackspaceKeys({
		onBackspace: deleteCharsBefore,
		onDelete: deleteCharsAfter,
		isActive: !activePanel,
	})

	useEffect(() => {
		skipNextPersistRef.current = true
		const stored = inputStateStorage.get(storageKey)
		if (stored) {
			setTextInput(stored.text)
			setCursorPos(stored.cursorPos)
			setPastedTexts(new Map(stored.pastedTexts))
			pasteCounterRef.current = stored.pasteCounter
			return
		}

		setTextInput("")
		setCursorPos(0)
		setPastedTexts(new Map())
		pasteCounterRef.current = 0
	}, [storageKey, setTextInput, setCursorPos])

	useEffect(() => {
		if (skipNextPersistRef.current) {
			skipNextPersistRef.current = false
			return
		}
		if (textInput || pastedTexts.size > 0) {
			inputStateStorage.set(storageKey, {
				text: textInput,
				cursorPos,
				pastedTexts: new Map(pastedTexts),
				pasteCounter: pasteCounterRef.current,
			})
			return
		}

		inputStateStorage.delete(storageKey)
	}, [storageKey, textInput, cursorPos, pastedTexts])

	const mentionInfo = useMemo(() => extractMentionQuery(textInput, cursorPos), [textInput, cursorPos])
	const slashInfo = useMemo(() => extractSlashQuery(textInput, cursorPos), [textInput, cursorPos])
	const filteredCommands = useMemo(
		() => filterCommands(availableCommands, slashInfo.query),
		[availableCommands, slashInfo.query],
	)

	useEffect(() => {
		if (slashInfo.slashIndex !== lastSlashIndexRef.current) {
			lastSlashIndexRef.current = slashInfo.slashIndex
			setSlashMenuDismissed(false)
			setSelectedSlashIndex(0)
		}
	}, [slashInfo.slashIndex])

	useEffect(() => {
		const cliOnlyCommands: SlashCommandInfo[] = CLI_ONLY_COMMANDS.map((cmd) => ({
			name: cmd.name,
			description: cmd.description || "",
			section: cmd.section || "default",
			cliCompatible: true,
		}))
		setAvailableCommands(cliOnlyCommands)
		if (!ctrl) return

		let cancelled = false
		getAvailableSlashCommands(ctrl, EmptyRequest.create()).then(
			(response) => {
				if (cancelled) return
				const backendCommands = response.commands.filter((cmd) => cmd.cliCompatible !== false)
				setAvailableCommands(mergeCliSlashCommands(cliOnlyCommands, backendCommands))
			},
			(error) => {
				Logger.error("Failed to load slash commands:", error)
			},
		)

		return () => {
			cancelled = true
		}
	}, [ctrl])

	useEffect(() => {
		return () => {
			searchRef.current.requestId += 1
			if (searchRef.current.searchTimeout) clearTimeout(searchRef.current.searchTimeout)
			if (pasteUpdateTimeoutRef.current) clearTimeout(pasteUpdateTimeoutRef.current)
			if (ripgrepWarningTimeoutRef.current) clearTimeout(ripgrepWarningTimeoutRef.current)
		}
	}, [])

	const getHistoryItems = useCallback(() => {
		const history = StateManager.get().getGlobalStateKey("taskHistory")
		if (!history?.length) return []
		const filtered = [...history]
			.filter((item) =>
				Boolean(
					(item.cwdOnTaskInitialization && arePathsEqual(item.cwdOnTaskInitialization, workspacePath)) ||
						(item.workspaceRootPath && arePathsEqual(item.workspaceRootPath, workspacePath)) ||
						(item.shadowGitConfigWorkTree && arePathsEqual(item.shadowGitConfigWorkTree, workspacePath)),
				),
			)
			.reverse()
			.map((item) => item.task)
			.slice(0, MAX_HISTORY_ITEMS)
			.filter(Boolean) as string[]
		return [...new Set(filtered)]
	}, [workspacePath])

	useEffect(() => {
		const { current: r } = searchRef
		if (!mentionInfo.inMentionMode) {
			r.requestId += 1
			r.lastQuery = null
			setFileResults([])
			setSelectedIndex(0)
			setIsSearching(false)
			setFileSearchError(null)
			if (r.searchTimeout) {
				clearTimeout(r.searchTimeout)
				r.searchTimeout = null
			}
			return
		}
		if (!r.hasCheckedRipgrep) {
			r.hasCheckedRipgrep = true
			if (checkAndWarnRipgrepMissing()) {
				setShowRipgrepWarning(true)
				ripgrepWarningTimeoutRef.current = setTimeout(() => setShowRipgrepWarning(false), RIPGREP_WARNING_DURATION_MS)
			}
		}
		const { query } = mentionInfo
		if (query === r.lastQuery) return
		r.lastQuery = query
		if (r.searchTimeout) clearTimeout(r.searchTimeout)
		setIsSearching(true)
		setFileSearchError(null)
		const requestId = ++r.requestId
		r.searchTimeout = setTimeout(async () => {
			try {
				let results: FileSearchResult[]
				if (query.toLowerCase().startsWith("image")) {
					let imageQuery = ""
					if (query.toLowerCase() === "image") {
						imageQuery = ""
					} else if (query.toLowerCase().startsWith("image:")) {
						imageQuery = query.slice(6)
					} else {
						imageQuery = query.slice(5)
					}
					results = await searchWorkspaceFiles(imageQuery, workspacePath, MAX_SEARCH_RESULTS, "file", [
						"png",
						"jpg",
						"jpeg",
						"gif",
						"webp",
					])
				} else {
					results = await searchWorkspaceFiles(query, workspacePath, MAX_SEARCH_RESULTS)
				}
				if (requestId === r.requestId) {
					setFileResults(results)
					setSelectedIndex(0)
				}
			} catch (error) {
				Logger.error("Failed to search workspace files:", error)
				if (requestId === r.requestId) {
					setFileResults([])
					setFileSearchError(error instanceof Error ? error.message : String(error))
				}
			} finally {
				if (requestId === r.requestId) setIsSearching(false)
			}
		}, SEARCH_DEBOUNCE_MS)
		return () => {
			if (r.searchTimeout) clearTimeout(r.searchTimeout)
		}
	}, [mentionInfo.inMentionMode, mentionInfo.query, workspacePath])

	useChatInputHandler({
		workspacePath,
		isEmptyConversation,
		textInputRef,
		cursorPosRef,
		setTextInput,
		setCursorPos,
		activePanel,
		setActivePanel,
		handleAskShortcuts: (input, key, currentTextInput) => actionsRef.current.handleAskShortcuts(input, key, currentTextInput),
		handleKeyboardSequence,
		handleCtrlShortcut,
		insertTextAtCursor,
		toggleMode: () => actionsRef.current.toggleMode(),
		toggleAutoApproveAll: () => actionsRef.current.toggleAutoApproveAll(),
		enableFastMode: () => actionsRef.current.enableFastMode(),
		toggleQuietMode: () => actionsRef.current.toggleQuietMode(),
		handleSubmit: (text, images) => actionsRef.current.handleSubmit(text, images),
		handleExit: () => actionsRef.current.handleExit(),
		clearViewAndResetTask: () => actionsRef.current.clearViewAndResetTask(),
		filteredCommands,
		selectedSlashIndex,
		setSelectedSlashIndex,
		slashMenuDismissed,
		setSlashMenuDismissed,
		fileResults,
		selectedIndex,
		setSelectedIndex,
		setFileResults,
		getHistoryItems,
		historyIndex,
		setHistoryIndex,
		savedInput,
		setSavedInput,
		isSpinnerActive,
		isProcessing,
		uiActionState,
		yolo,
		pendingAsk,
		handleButtonAction: (action, isPrimary, value) => actionsRef.current.handleButtonAction(action, isPrimary, value),
		isYoloSuppressed,
		lastPasteTimeRef,
		activePasteNumRef,
		activePasteLinesRef,
		activePasteStartPosRef,
		pasteCounterRef,
		pasteUpdateTimeoutRef,
		setPastedTexts,
		PASTE_COLLAPSE_THRESHOLD,
		PASTE_CHUNK_WINDOW_MS,
		PASTE_UPDATE_DEBOUNCE_MS,
		mode,
		scrollableCardMaxOffset,
		cardScrollOffset,
		setCardScrollOffset,
		goalStatus,
		handleGoalControl,
		toggleGoalDetails,
		disarmGoalStopConfirmation,
	})

	const resetInput = useCallback(() => {
		setTextInput("")
		setCursorPos(0)
		setPastedTexts(new Map())
		pasteCounterRef.current = 0
		inputStateStorage.delete(storageKey)
	}, [setTextInput, setCursorPos, storageKey])

	const { imagePaths } = parseImagesFromInput(textInput, workspacePath)
	const showSlashMenu = slashInfo.inSlashMode && !slashMenuDismissed
	const showFileMenu = mentionInfo.inMentionMode && !showSlashMenu

	return {
		textInput,
		cursorPos,
		setTextInput,
		setCursorPos,
		pastedTexts,
		pasteCounterRef,
		storageKey,
		resetInput,
		availableCommands,
		availableCommandNames: availableCommands.map((command) => command.name),
		filteredCommands,
		selectedSlashIndex,
		slashInfo,
		showSlashMenu,
		fileResults,
		selectedIndex,
		mentionInfo,
		showFileMenu,
		isSearching,
		showRipgrepWarning,
		fileSearchError,
		imagePaths,
	}
}

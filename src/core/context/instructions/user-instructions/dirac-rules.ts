import {
	ActivatedConditionalRule,
	getRemoteRulesTotalContentWithMetadata,
	getRuleFilesTotalContentWithMetadata,
	RULE_SOURCE_PREFIX,
	RuleLoadResultWithInstructions,
	synchronizeRuleToggles,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/formatResponse"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { DiracRulesToggles } from "@shared/dirac-rules"
import type { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { parseYamlFrontmatter } from "@utils/frontmatter"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { getErrorMessage } from "@/shared/errors"
import { Logger } from "@/shared/services/Logger"
import { evaluateRuleConditionals, type RuleEvaluationContext } from "./rule-conditionals"

export const getGlobalDiracRules = async (
	globalDiracRulesFilePath: string,
	toggles: DiracRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	let combinedContent = ""
	const activatedConditionalRules: ActivatedConditionalRule[] = []
	const errors: string[] = []

	// 1. Get file-based rules
	if (await fileExistsAtPath(globalDiracRulesFilePath)) {
		if (await isDirectory(globalDiracRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalDiracRulesFilePath)
				// Note: ruleNamePrefix explicitly set to "global" for clarity (matches the default)
				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(
					rulesFilePaths,
					globalDiracRulesFilePath,
					toggles,
					{
						evaluationContext: opts?.evaluationContext,
						ruleNamePrefix: "global",
					},
				)
				if (rulesFilesTotal.content) {
					combinedContent = rulesFilesTotal.content
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
				if (rulesFilesTotal.errors) {
					errors.push(...rulesFilesTotal.errors)
				}
			} catch (error) {
				const message = `Failed to read .diracrules directory at ${globalDiracRulesFilePath}: ${getErrorMessage(error)}`
				Logger.error(message, error)
				errors.push(message)
			}
		} else {
			const message = `${globalDiracRulesFilePath} is not a directory`
			Logger.error(message)
			errors.push(message)
		}
	}

	// 2. Append remote config rules
	const stateManager = StateManager.get()
	const remoteRules: GlobalInstructionsFile[] = []
	const remoteToggles = stateManager.getGlobalStateKey("remoteRulesToggles") || {}
	const remoteResult = getRemoteRulesTotalContentWithMetadata(remoteRules, remoteToggles, {
		evaluationContext: opts?.evaluationContext,
	})
	if (remoteResult.content) {
		if (combinedContent) combinedContent += "\n\n"
		combinedContent += remoteResult.content
		activatedConditionalRules.push(...remoteResult.activatedConditionalRules)
	}
	if (remoteResult.errors) {
		errors.push(...remoteResult.errors)
	}

	// 3. Return formatted instructions
	if (!combinedContent) {
		return { instructions: undefined, activatedConditionalRules: [], errors: errors.length > 0 ? errors : undefined }
	}

	return {
		instructions: formatResponse.diracRulesGlobalDirectoryInstructions(globalDiracRulesFilePath, combinedContent),
		activatedConditionalRules,
		errors: errors.length > 0 ? errors : undefined,
	}
}

export const getLocalDiracRules = async (
	cwd: string,
	toggles: DiracRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	const diracRulesFilePath = path.resolve(cwd, GlobalFileNames.diracRules)

	let instructions: string | undefined
	const activatedConditionalRules: ActivatedConditionalRule[] = []
	const errors: string[] = []

	if (await fileExistsAtPath(diracRulesFilePath)) {
		if (await isDirectory(diracRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(diracRulesFilePath, [
					[".diracrules", "workflows"],
					[".diracrules", "hooks"],
					[".diracrules", "skills"],
				])

				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(rulesFilePaths, cwd, toggles, {
					evaluationContext: opts?.evaluationContext,
					ruleNamePrefix: "workspace",
				})
				if (rulesFilesTotal.content) {
					instructions = formatResponse.diracRulesLocalDirectoryInstructions(cwd, rulesFilesTotal.content)
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
				if (rulesFilesTotal.errors) {
					errors.push(...rulesFilesTotal.errors)
				}
			} catch (error) {
				const message = `Failed to read .diracrules directory at ${diracRulesFilePath}: ${getErrorMessage(error)}`
				Logger.error(message, error)
				errors.push(message)
			}
		} else {
			try {
				if (diracRulesFilePath in toggles && toggles[diracRulesFilePath] !== false) {
					const raw = (await fs.readFile(diracRulesFilePath, "utf8")).trim()
					if (raw) {
						// Keep single-file .diracrules behavior consistent with directory/remote rules:
						// - Parse YAML frontmatter (fail-open on parse errors)
						// - Evaluate conditionals against the request's evaluation context
						const parsed = parseYamlFrontmatter(raw)
						if (parsed.hadFrontmatter && parsed.parseError) {
							// Fail-open: preserve the raw contents so the LLM can still see the author's intent.
							instructions = formatResponse.diracRulesLocalFileInstructions(cwd, raw)
						} else {
							const { passed, matchedConditions } = evaluateRuleConditionals(
								parsed.data,
								opts?.evaluationContext ?? {},
							)
							if (passed) {
								instructions = formatResponse.diracRulesLocalFileInstructions(cwd, parsed.body.trim())
								if (parsed.hadFrontmatter && Object.keys(matchedConditions).length > 0) {
									activatedConditionalRules.push({
										name: `${RULE_SOURCE_PREFIX.workspace}:${GlobalFileNames.diracRules}`,
										matchedConditions,
									})
								}
							}
						}
					}
				}
			} catch (error) {
				const message = `Failed to read .diracrules file at ${diracRulesFilePath}: ${getErrorMessage(error)}`
				Logger.error(message, error)
				errors.push(message)
			}
		}
	}

	return { instructions, activatedConditionalRules, errors: errors.length > 0 ? errors : undefined }
}

export async function refreshDiracRulesToggles(
	stateManager: StateManager,
	workingDirectory: string,
	configuration?: { globalToggles: DiracRulesToggles; localToggles: DiracRulesToggles },
): Promise<{
	globalToggles: DiracRulesToggles
	localToggles: DiracRulesToggles
}> {
	// Global toggles
	const globalDiracRulesToggles = configuration?.globalToggles ?? stateManager.getGlobalSettingsKey("globalDiracRulesToggles")
	const globalDiracRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalDiracRulesFilePath, globalDiracRulesToggles)
	if (!configuration) stateManager.setGlobalState("globalDiracRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localDiracRulesToggles = configuration?.localToggles ?? stateManager.getWorkspaceStateKey("localDiracRulesToggles")
	const localDiracRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.diracRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localDiracRulesFilePath, localDiracRulesToggles, "", [
		[".diracrules", "workflows"],
		[".diracrules", "hooks"],
		[".diracrules", "skills"],
	])
	if (!configuration) stateManager.setWorkspaceState("localDiracRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}

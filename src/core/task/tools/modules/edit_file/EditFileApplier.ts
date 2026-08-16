import { CardStatus } from "@/shared/ExtensionMessage"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"
import type { ToolResponse } from "../../types/ToolResponse"
import { PreparedFileBatch } from "./types"
import { EditFormatter } from "./utils/EditFormatter"

// Applies prepared batches to disk, formats files, and produces final diagnostic results.
export class EditFileApplier {
	constructor(private resultsFormatter: EditFormatter) {}

	async applyAndSave(
		env: IToolEnvironment,
		preparedBatches: PreparedFileBatch[],
		cards: Record<string, any>,
		userEdits?: Record<string, string>,
	): Promise<Map<string, any>> {
		const appliedResults = new Map<string, any>()

		await Promise.all(
			preparedBatches.map(async (batch) => {
				const card = cards[batch.absolutePath]
				if (card) await card.update({ status: CardStatus.RUNNING, body: "Applying edits..." })
			}),
		)

		const filesToApply = preparedBatches.map((batch) => ({
			path: batch.absolutePath,
			content: userEdits?.[batch.displayPath] ?? batch.prepared!.finalContent,
		}))
		const batchResults = await env.editor.applyAndSaveBatchSilently(filesToApply)

		for (const batch of preparedBatches) {
			try {
				await env.editor.format(batch.absolutePath)
			} catch {
				/* formatting is best-effort */
			}
		}

		await Promise.all(
			preparedBatches.map(async (batch) => {
				const saveResult = batchResults.get(batch.absolutePath)
				if (!saveResult) return
				let finalContent: string
				try {
					finalContent = await env.workspace.readFile(batch.absolutePath)
				} catch {
					finalContent = saveResult.content || batch.prepared!.finalContent
				}
				const finalLines = finalContent.split(/\r?\n/)

				appliedResults.set(batch.absolutePath, {
					saveResult,
					finalContent,
					finalLines,
					newLineHashes: env.anchors.reconcile(batch.absolutePath, finalLines),
				})

				const card = cards[batch.absolutePath]
				if (!card) return
				const prepared = batch.prepared!
				const isPartial = prepared.failedEdits.length > 0
				const header = isPartial
					? `Partially edited ${batch.displayPath} — ${prepared.resolvedEdits.length} applied, ${prepared.failedEdits.length} failed`
					: `Edited ${batch.displayPath} — ${prepared.resolvedEdits.length} edit(s) applied`
				const failureSummary = prepared.failedEdits
					.map((failed) => `files[${prepared.fileIndex}].edits[${failed.editIndex}] failed: ${failed.error}`)
					.join("\n\n")
				await card.update({
					header,
					status: CardStatus.SUCCESS,
					toolName: card.toolName ?? "edit_file",
					body: [prepared.diff, failureSummary].filter(Boolean).join("\n\n"),
					renderType: "diff",
					rawInput: { tool: "edit_file", path: batch.displayPath },
					locations: [{ path: batch.displayPath }],
					diffs: [
						{
							path: batch.displayPath,
							oldText: prepared.content,
							newText: finalContent,
						},
					],
				})
				await card.finalize(CardStatus.SUCCESS)
			}),
		)

		return appliedResults
	}

	async finalizeResults(
		env: IToolEnvironment,
		preparedBatches: PreparedFileBatch[],
		appliedResults: Map<string, any>,
	): Promise<ToolResponse[]> {
		const results: ToolResponse[] = []
		const paths = preparedBatches.map((b) => b.absolutePath)
		await env.diagnostics.prepare(paths)
		const rawDiagnostics = await env.diagnostics.getRaw(paths)

		for (const batch of preparedBatches) {
			const applied = appliedResults.get(batch.absolutePath)
			const fileDiagnostics = rawDiagnostics.find((d) => d.filePath === batch.absolutePath)?.diagnostics || []
			const diagnosticDetails = await env.diagnostics.formatProblems(
				[{ filePath: batch.absolutePath, diagnostics: fileDiagnostics }],
				new Map([[batch.absolutePath, { lines: applied.finalLines, hashes: applied.newLineHashes }]]),
			)
			const diagnosticsResult = {
				newProblemsMessage:
					fileDiagnostics.length > 0
						? `Found ${fileDiagnostics.length} problems${diagnosticDetails ? `\n${diagnosticDetails}` : ""}`
						: "",
				fixedCount: 0,
			}
			const result = this.resultsFormatter.createResultsResponse(
				batch.prepared!,
				applied.finalLines,
				applied.newLineHashes,
				diagnosticsResult,
				"full",
				applied.saveResult?.autoFormattingEdits,
				applied.saveResult?.userEdits,
				false,
			)
			results.push(result)
		}
		return results
	}
}

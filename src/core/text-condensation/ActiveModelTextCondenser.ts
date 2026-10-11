import type { ApiHandler } from "@core/api"
import type { ApiStream } from "@core/api/transform/stream"
import { UtilityModelCancelledError } from "@core/utility-model/UtilityModelRunner"
import {
	TextCondensationOutputError,
	type TextCondenser,
	type TextCondensationOptions,
	type TextStream,
} from "./TextCondenser"
import type { TextCondensationTemplateRegistry } from "./TextCondensationTemplateRegistry"

/**
 * Runs text condensation on an isolated active-model handler. Used
 * only as an explicit user-requested fallback when no Utility model is
 * configured; automatic condensation never uses the active model so a full
 * context cannot silently burn main-model tokens.
 */
export class ActiveModelTextCondenser implements TextCondenser {
	constructor(
		private readonly handler: ApiHandler,
		private readonly templates: TextCondensationTemplateRegistry,
	) {}

	condense(input: TextStream, options: TextCondensationOptions): TextStream {
		return this.stream(input, options)
	}

	private async *stream(input: TextStream, options: TextCondensationOptions): AsyncGenerator<string> {
		const template = this.templates.get(options.template)
		const source = await this.collectInput(input, options.signal)
		if (source.length === 0) return
		const stream = this.handler.createMessage(
			template.systemPrompt,
			[{ role: "user", content: template.buildSourceMessage(source) }],
			undefined,
		)
		const output = await this.collectOutput(stream, options.signal)

		template.validateOutput(output, source)
		yield output
	}

	private async collectInput(input: TextStream, signal?: AbortSignal): Promise<string> {
		this.throwIfCancelled(signal)
		let source = ""
		for await (const chunk of input) {
			this.throwIfCancelled(signal)
			source += chunk
		}
		this.throwIfCancelled(signal)
		return source
	}

	private async collectOutput(stream: ApiStream, signal?: AbortSignal): Promise<string> {
		let output = ""
		// Never touches the caller handler: the fallback path may share the live
		// task handler, whose single abortController is also used by the follow-up
		// main-model request. Aborting it here wedges the next turn. Callers that
		// need cancellation own a disposable handler and abort it themselves via
		// the linked signal listener.
		for await (const chunk of stream) {
			this.throwIfCancelled(signal)
			if (chunk.type === "text") {
				output += chunk.text
				continue
			}
			if (chunk.type === "tool_calls") {
				throw new TextCondensationOutputError("Text condensation returned a tool call")
			}
		}
		this.throwIfCancelled(signal)
		return output
	}

	private throwIfCancelled(signal?: AbortSignal): void {
		if (signal?.aborted) throw new UtilityModelCancelledError()
	}
}

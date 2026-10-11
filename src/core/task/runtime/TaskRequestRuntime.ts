import { AsyncLocalStorage } from "node:async_hooks"
import type { ApiHandler } from "@core/api"
import { ulid } from "ulid"
import type { ToolRequestSnapshot } from "../tools/runtime/ToolSnapshot"
import type { TaskWorkingConfiguration } from "./TaskWorkingConfiguration"

/**
 * Immutable configuration and model runtime bound to one outbound model request.
 *
 * The API handler and working configuration are the exact instances used to
 * construct the request. A tool snapshot is attached after prompt/tool discovery
 * without changing the request identity or configuration revision.
 */
export interface TaskRequestRuntime {
	readonly requestId: string
	readonly workingConfiguration: TaskWorkingConfiguration
	readonly api: ApiHandler
	readonly toolSnapshot?: ToolRequestSnapshot
}

export function createTaskRequestRuntime(
	workingConfiguration: TaskWorkingConfiguration,
	api: ApiHandler,
	requestId = ulid(),
): TaskRequestRuntime {
	return Object.freeze({ requestId, workingConfiguration, api })
}

export function bindToolSnapshotToRequestRuntime(
	runtime: TaskRequestRuntime,
	toolSnapshot: ToolRequestSnapshot,
): TaskRequestRuntime {
	if (toolSnapshot.requestId !== runtime.requestId) {
		throw new Error(
			`Tool snapshot request identity mismatch: expected ${runtime.requestId}, received ${toolSnapshot.requestId}`,
		)
	}
	if (
		toolSnapshot.configurationRevision !== undefined &&
		toolSnapshot.configurationRevision !== runtime.workingConfiguration.revision
	) {
		throw new Error(
			`Tool snapshot configuration revision mismatch: expected ${runtime.workingConfiguration.revision}, received ${toolSnapshot.configurationRevision}`,
		)
	}
	return Object.freeze({ ...runtime, toolSnapshot })
}

/**
 * Mutation consent follows each configuration's established strict-Plan policy.
 * Unrelated revisions do not invalidate a request, but enabling strict Plan mode
 * at either the request or current boundary cannot grant mutation retroactively.
 */
export function isTaskMutationAuthorized(
	requestConfiguration: TaskWorkingConfiguration,
	currentConfiguration: TaskWorkingConfiguration,
): boolean {
	const requestDenied =
		requestConfiguration.settings.mode === "plan" && requestConfiguration.settings.strictPlanModeEnabled === true
	const currentDenied =
		currentConfiguration.settings.mode === "plan" && currentConfiguration.settings.strictPlanModeEnabled === true
	return !requestDenied && !currentDenied
}

export class TaskMutationGate {
	private activeMutations = 0
	private transitionActive = false
	private readonly transitionWaiters: Array<() => void> = []
	private readonly mutationWaiters: Array<() => void> = []
	private readonly mutationLease = new AsyncLocalStorage<{ mutationActive: boolean; transitionActive: boolean }>()

	async withMutation<T>(authorize: () => void, mutation: () => Promise<T>): Promise<T> {
		if (this.mutationLease.getStore()?.mutationActive) {
			authorize()
			return mutation()
		}
		await this.acquireMutation(authorize)
		const lease = { mutationActive: true, transitionActive: false }
		try {
			return await this.mutationLease.run(lease, mutation)
		} finally {
			if (lease.mutationActive) {
				lease.mutationActive = false
				this.releaseMutation()
			}
		}
	}

	async transitionFromMutation<T>(transition: () => T | Promise<T>): Promise<T> {
		const lease = this.mutationLease.getStore()
		if (!lease?.mutationActive) return this.withTransition(transition)
		lease.mutationActive = false
		this.activeMutations -= 1
		await this.acquireTransitionFromMutation()
		lease.transitionActive = true
		try {
			return await transition()
		} finally {
			lease.transitionActive = false
			this.releaseTransition()
		}
	}

	retainMutationUntil(completion: Promise<void>): void {
		if (!this.mutationLease.getStore()?.mutationActive) {
			throw new Error("A mutation lease can only be retained from an active mutation")
		}
		this.activeMutations += 1
		void completion.then(
			() => this.releaseMutation(),
			() => this.releaseMutation(),
		)
	}

	async withTransition<T>(transition: () => T | Promise<T>): Promise<T> {
		if (this.mutationLease.getStore()?.transitionActive) return transition()
		await this.acquireTransition()
		try {
			return await transition()
		} finally {
			this.releaseTransition()
		}
	}

	private async acquireMutation(authorize: () => void): Promise<void> {
		while (this.transitionActive || this.transitionWaiters.length > 0) {
			await new Promise<void>((resolve) => this.mutationWaiters.push(resolve))
		}
		authorize()
		this.activeMutations += 1
	}

	private releaseMutation(): void {
		this.activeMutations -= 1
		if (this.activeMutations === 0) this.startNextTransition()
	}

	private async acquireTransition(): Promise<void> {
		if (!this.transitionActive && this.activeMutations === 0 && this.transitionWaiters.length === 0) {
			this.transitionActive = true
			return
		}
		await new Promise<void>((resolve) => this.transitionWaiters.push(resolve))
	}

	private async acquireTransitionFromMutation(): Promise<void> {
		if (!this.transitionActive && this.activeMutations === 0) {
			this.transitionActive = true
			return
		}
		await new Promise<void>((resolve) => this.transitionWaiters.unshift(resolve))
	}

	private releaseTransition(): void {
		this.transitionActive = false
		if (this.startNextTransition()) return
		for (const resolve of this.mutationWaiters.splice(0)) resolve()
	}

	private startNextTransition(): boolean {
		if (this.transitionActive || this.activeMutations > 0) return false
		const resolve = this.transitionWaiters.shift()
		if (!resolve) return false
		this.transitionActive = true
		resolve()
		return true
	}
}

export function assertTaskMutationAuthorized(
	requestConfiguration: TaskWorkingConfiguration,
	currentConfiguration: TaskWorkingConfiguration,
	toolName = "mutation tool",
): void {
	if (isTaskMutationAuthorized(requestConfiguration, currentConfiguration)) return
	throw new Error(`Tool '${toolName}' is not authorized because Plan Mode does not permit file mutations.`)
}

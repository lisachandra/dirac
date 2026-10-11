import { describe, expect, it, vi } from "vitest"
import { commitInteractiveSetting, persistInteractiveSettingWithRollback } from "./settingsTransaction"

describe("commitInteractiveSetting", () => {
	it("runs persistence at the active Task commit boundary before publication", async () => {
		const order: string[] = []
		const persist = vi.fn(async () => {
			order.push("persist")
		})
		const applyWorkingConfigurationUpdate = vi.fn(async (_patch, beforeCommit) => {
			order.push("validate")
			await beforeCommit?.()
			order.push("commit")
		})
		const postStateToWebview = vi.fn(async () => {
			order.push("publish")
		})
		const controller = { task: { applyWorkingConfigurationUpdate }, postStateToWebview } as any

		await commitInteractiveSetting(controller, { settings: { preferredLanguage: "French" } }, persist)

		expect(order).toEqual(["validate", "persist", "commit", "publish"])
		expect(applyWorkingConfigurationUpdate).toHaveBeenCalledOnce()
	})

	it("does not persist or publish when candidate validation fails", async () => {
		const persist = vi.fn()
		const postStateToWebview = vi.fn()
		const controller = {
			task: {
				applyWorkingConfigurationUpdate: vi.fn(async () => {
					throw new Error("invalid candidate")
				}),
			},
			postStateToWebview,
		} as any

		await expect(commitInteractiveSetting(controller, { settings: { mode: "act" } }, persist)).rejects.toThrow(
			"invalid candidate",
		)
		expect(persist).not.toHaveBeenCalled()
		expect(postStateToWebview).not.toHaveBeenCalled()
	})

	it("leaves the Task unpublished when persistence fails", async () => {
		let committed = false
		const persist = vi.fn(async () => {
			throw new Error("persistence failed")
		})
		const postStateToWebview = vi.fn()
		const controller = {
			task: {
				applyWorkingConfigurationUpdate: vi.fn(async (_patch, beforeCommit) => {
					await beforeCommit?.()
					committed = true
				}),
			},
			postStateToWebview,
		} as any

		await expect(
			commitInteractiveSetting(controller, { settings: { preferredLanguage: "French" } }, persist),
		).rejects.toThrow("persistence failed")
		expect(committed).toBe(false)
		expect(postStateToWebview).not.toHaveBeenCalled()
	})

	it("persists defaults and publishes when no active Task exists", async () => {
		const persist = vi.fn()
		const postStateToWebview = vi.fn()
		const controller = { task: undefined, postStateToWebview } as any

		await commitInteractiveSetting(controller, { settings: { preferredLanguage: "French" } }, persist)

		expect(persist).toHaveBeenCalledOnce()
		expect(postStateToWebview).toHaveBeenCalledOnce()
	})

	it("restores explicitly addressed persistence when a durable write fails", async () => {
		const order: string[] = []
		const persist = vi.fn(async () => {
			order.push("persist")
			throw new Error("flush failed")
		})
		const rollback = vi.fn(async () => {
			order.push("rollback")
		})

		await expect(persistInteractiveSettingWithRollback(persist, rollback)).rejects.toThrow("flush failed")
		expect(order).toEqual(["persist", "rollback"])
	})
})

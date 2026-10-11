import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { TaskStatus } from "@shared/ExtensionMessage"
import { Task } from "../index"
import { TaskState } from "../TaskState"

function createTask() {
	const task = Object.create(Task.prototype) as {
		taskState: TaskState
		lifecycleManager?: { abortTask: () => Promise<void> }
		abortTask: () => Promise<void>
	}
	task.taskState = new TaskState()
	return task
}

describe("Task abort / state transitions", () => {
	it("sets status to CANCELLING and delegates when not cancelled", async () => {
		const task = createTask()
		const abort = sinon.stub().resolves()
		task.lifecycleManager = { abortTask: abort }
		task.taskState.status = TaskStatus.EXECUTING_TOOL
		await task.abortTask()
		assert.equal(task.taskState.status, TaskStatus.CANCELLING)
		assert.equal(abort.callCount, 1)
	})
	it("keeps CANCELLED status and still delegates when already cancelled", async () => {
		const task = createTask()
		const abort = sinon.stub().resolves()
		task.lifecycleManager = { abortTask: abort }
		task.taskState.status = TaskStatus.CANCELLED
		await task.abortTask()
		assert.equal(task.taskState.status, TaskStatus.CANCELLED)
		assert.equal(abort.callCount, 1)
	})
})

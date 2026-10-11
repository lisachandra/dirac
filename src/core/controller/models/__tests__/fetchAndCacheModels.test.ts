import fs from "node:fs/promises"
import "should"
import { afterEach, describe, it } from "mocha"
import axios from "axios"
import sinon from "sinon"
import * as disk from "@core/storage/disk"
import type { ModelInfo } from "@shared/api"
import { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import * as fsUtils from "@utils/fs"
import { fetchAndCacheModels } from "../fetchAndCacheModels"

describe("fetchAndCacheModels", () => {
	afterEach(() => sinon.restore())

	it("retries after a failed fetch has no cached fallback", async () => {
		let cachedModels: Record<string, ModelInfo> | null = null
		const getModelsCache = sinon.stub().callsFake(() => cachedModels)
		const setModelsCache = sinon.stub().callsFake((_provider: string, models: Record<string, ModelInfo>) => {
			cachedModels = models
		})
		sinon.stub(StateManager, "get").returns({ getModelsCache, setModelsCache } as any)
		sinon.stub(disk, "ensureCacheDirectoryExists").resolves("/tmp")
		sinon.stub(fsUtils, "fileExistsAtPath").resolves(false)
		sinon.stub(fs, "writeFile").resolves()
		sinon.stub(Logger, "error")

		const get = sinon.stub(axios, "get")
		get.onFirstCall().rejects(new Error("temporary failure"))
		get.onSecondCall().resolves({ data: { data: [{ id: "model-1" }] } })
		const config = {
			provider: "retryable-test-provider",
			cacheFileName: "retryable-test-models.json",
			fetchUrl: "https://provider.example/models",
			parseResponse: (models: { id: string }[]) =>
				Object.fromEntries(models.map(({ id }) => [id, { name: id, supportsPromptCache: false }])),
		}

		;(await fetchAndCacheModels(config)).should.deepEqual({})
		;(await fetchAndCacheModels(config)).should.deepEqual({
			"model-1": { name: "model-1", supportsPromptCache: false },
		})
		sinon.assert.calledTwice(get)
		sinon.assert.calledOnce(setModelsCache)
	})
})

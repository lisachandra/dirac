import { UpdateSettingsRequest } from "@shared/proto/dirac/state"
import { StateServiceClient } from "@/shared/api/grpc-client"

function createUpdateSettingsRequest<K extends keyof UpdateSettingsRequest>(
	field: K,
	value: UpdateSettingsRequest[K],
): UpdateSettingsRequest {
	const updateRequest: Partial<UpdateSettingsRequest> = {}
	updateRequest[field] = value as never
	return UpdateSettingsRequest.create(updateRequest)
}

export const persistSetting = <K extends keyof UpdateSettingsRequest>(field: K, value: UpdateSettingsRequest[K]) => {
	return StateServiceClient.updateSettings(createUpdateSettingsRequest(field, value))
}

/** Updates a single setting without blocking the caller. */
export const updateSetting = <K extends keyof UpdateSettingsRequest>(field: K, value: UpdateSettingsRequest[K]): void => {
	void persistSetting(field, value).catch((error) => {
		console.error(`Failed to update setting ${field}:`, error)
	})
}

declare module "proper-lockfile" {
	export interface RetryOptions {
		retries?: number
		factor?: number
		minTimeout?: number
		maxTimeout?: number
		randomize?: boolean
	}

	export interface LockOptions {
		realpath?: boolean
		stale?: number
		update?: number
		retries?: number | RetryOptions
	}

	export type ReleaseLock = () => Promise<void>

	export function lock(file: string, options?: LockOptions): Promise<ReleaseLock>
}

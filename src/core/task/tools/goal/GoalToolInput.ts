import type { GoalChildRole, GoalChildStatus } from "@shared/goal"
import type { IGoalTrait, IToolEnvironment } from "../interfaces/IToolEnvironment"

const GOAL_CHILD_STATUSES: readonly GoalChildStatus[] = [
	"starting",
	"running",
	"waiting",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
]

const GOAL_CHILD_ROLES: readonly GoalChildRole[] = ["task", "verification"]

export type GoalToolArguments = Record<string, unknown>

export function requireGoalTrait(environment: IToolEnvironment): IGoalTrait {
	if (!environment.goal) throw new Error("Goal tool requires a Goal coordinator environment.")
	return environment.goal
}

export function requireArguments(value: unknown): GoalToolArguments {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Goal tool arguments must be an object.")
	}
	return value as GoalToolArguments
}

export function requireNonEmptyString(argumentsValue: GoalToolArguments, name: string): string {
	const value = argumentsValue[name]
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Parameter '${name}' must be a non-empty string.`)
	}
	return value
}

export function optionalNonEmptyString(argumentsValue: GoalToolArguments, name: string): string | undefined {
	const value = argumentsValue[name]
	if (value === undefined) return undefined
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Parameter '${name}' must be a non-empty string when provided.`)
	}
	return value
}

export function boundedLimit(argumentsValue: GoalToolArguments, defaultLimit: number, maximumLimit: number): number {
	const value = argumentsValue.limit
	if (value === undefined) return defaultLimit
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximumLimit) {
		throw new Error(`Parameter 'limit' must be an integer from 1 through ${maximumLimit}.`)
	}
	return value as number
}

export function optionalGoalChildRole(argumentsValue: GoalToolArguments): GoalChildRole | undefined {
	const value = argumentsValue.role
	if (value === undefined) return undefined
	if (typeof value !== "string" || !GOAL_CHILD_ROLES.includes(value as GoalChildRole)) {
		throw new Error("Parameter 'role' must be 'task' or 'verification'.")
	}
	return value as GoalChildRole
}

export function optionalGoalChildStatuses(argumentsValue: GoalToolArguments): GoalChildStatus[] | undefined {
	const value = argumentsValue.status
	if (value === undefined) return undefined
	if (!Array.isArray(value) || value.some((status) => !GOAL_CHILD_STATUSES.includes(status as GoalChildStatus))) {
		throw new Error("Parameter 'status' must be an array of valid Goal child statuses.")
	}
	return value as GoalChildStatus[]
}

export function goalToolJson(value: unknown): string {
	return JSON.stringify(value, null, 2)
}

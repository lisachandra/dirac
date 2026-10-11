import { type ChokidarOptions, type FSWatcher } from "chokidar"

export { DEFAULT_IGNORE_PATTERNS, INCLUDE_PREFIX } from "@/shared/ignore/DiracIgnorePolicy"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

export type WatcherFactory = (path: string, options?: ChokidarOptions) => FSWatcher

export type ReleaseKind = "patch" | "minor" | "major"

export interface ReleaseNoteAction {
	title: string
	url: string
}

export interface ReleaseNoteHighlight {
	id: string
	title: string
	bodyMd?: string
	category?: "feat" | "perf" | "fix"
	evidence?: string[]
	actions?: ReleaseNoteAction[]
}

export interface ReleaseNotesDocument {
	schemaVersion: 1
	version: string
	kind: ReleaseKind
	announce: boolean
	sourceTag: string
	analyzedCommit: string
	headline: string
	summaryMd?: string
	highlights: ReleaseNoteHighlight[]
	fixes?: string[]
}

export interface ReleaseNotesView {
	fromVersion: string
	toVersion: string
	releases: ReleaseNotesDocument[]
}

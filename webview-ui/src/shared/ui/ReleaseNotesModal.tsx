import type { BannerAction, BannerCardData } from "@shared/dirac/banner"
import type { ReleaseNoteAction, ReleaseNotesView } from "@shared/release-notes"
import React from "react"
import Markdown from "react-markdown"
import { UiServiceClient } from "@/shared/api/grpc-client"
import { Dialog, DialogContent } from "@/shared/ui/dialog"

interface ReleaseNotesModalProps {
	open: boolean
	onClose: () => void
	onRemoteAction?: (action: BannerAction) => void
	releaseNotes: ReleaseNotesView
	remoteNotes?: BannerCardData[]
}

const markdownComponents = {
	a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} rel="noopener noreferrer" target="_blank">
			{children}
		</a>
	),
	p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="m-0">{children}</p>,
}

function openAction(action: ReleaseNoteAction): void {
	UiServiceClient.openUrl({ value: action.url }).catch(console.error)
}

export const ReleaseNotesModal: React.FC<ReleaseNotesModalProps> = ({
	open,
	onClose,
	onRemoteAction,
	releaseNotes,
	remoteNotes,
}) => {
	const multipleReleases = releaseNotes.releases.length > 1
	const onlyRelease = releaseNotes.releases[0]
	const title =
		multipleReleases || onlyRelease?.version !== releaseNotes.toVersion
			? `🎉 What's new since v${releaseNotes.fromVersion}`
			: `🎉 What's new in Dirac v${onlyRelease.version}`

	return (
		<Dialog
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose()
			}}
			open={open}>
			<DialogContent
				aria-describedby="release-notes-description"
				aria-labelledby="release-notes-title"
				className="pt-5 px-5 pb-4 gap-0 max-h-[85vh] overflow-y-auto"
				hideClose={true}>
				<div id="release-notes-description">
					<div className="flex items-center justify-between gap-3 mb-4">
						<h2 className="text-lg font-semibold m-0" id="release-notes-title">
							{title}
						</h2>
						<button
							aria-label="Close"
							className="p-1 hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded-sm transition-colors cursor-pointer"
							onClick={onClose}
							type="button">
							<span className="codicon codicon-close text-lg" />
						</button>
					</div>

					<div className="flex flex-col gap-5 text-sm text-[var(--vscode-descriptionForeground)]">
						{releaseNotes.releases.map((release) => (
							<section key={release.version}>
								{multipleReleases && <div className="text-xs opacity-80 mb-1">Dirac v{release.version}</div>}
								{release.headline !== release.highlights[0]?.title && (
									<h3 className="text-base font-semibold text-[var(--vscode-foreground)] mt-0 mb-2">
										{release.headline}
									</h3>
								)}
								{release.summaryMd && (
									<div className="mb-3">
										<Markdown components={markdownComponents}>{release.summaryMd}</Markdown>
									</div>
								)}
								{release.highlights.length > 0 && (
									<ul className="pl-5 m-0 flex flex-col gap-3">
										{release.highlights.map((highlight) => (
											<li key={highlight.id}>
												<strong className="text-[var(--vscode-foreground)]">{highlight.title}</strong>
												{highlight.bodyMd && (
													<div className="mt-1">
														<Markdown components={markdownComponents}>{highlight.bodyMd}</Markdown>
													</div>
												)}
												{highlight.actions && highlight.actions.length > 0 && (
													<div className="flex flex-wrap gap-3 mt-1.5">
														{highlight.actions.map((action) => (
															<button
																className="text-[var(--vscode-textLink-foreground)] hover:underline bg-transparent border-0 p-0 cursor-pointer"
																key={`${highlight.id}-${action.url}`}
																onClick={() => openAction(action)}
																type="button">
																{action.title}
															</button>
														))}
													</div>
												)}
											</li>
										))}
									</ul>
								)}
								{release.fixes && release.fixes.length > 0 && (
									<details className="mt-3">
										<summary className="cursor-pointer text-[var(--vscode-foreground)]">
											Fixes and improvements
										</summary>
										<ul className="pl-5 mt-2 mb-0">
											{release.fixes.map((fix) => (
												<li key={fix}>{fix}</li>
											))}
										</ul>
									</details>
								)}
								<button
									className="text-[var(--vscode-textLink-foreground)] hover:underline bg-transparent border-0 p-0 mt-3 cursor-pointer"
									onClick={() =>
										openAction({
											title: "View full release notes",
											url: `https://github.com/dirac-run/dirac/releases/tag/v${release.version}`,
										})
									}
									type="button">
									View full release notes
								</button>
							</section>
						))}

						{remoteNotes && remoteNotes.length > 0 && (
							<section className="border-t border-[var(--vscode-widget-border)] pt-4">
								<h3 className="text-base font-semibold text-[var(--vscode-foreground)] mt-0 mb-2">Also new</h3>
								<ul className="pl-5 m-0 flex flex-col gap-2">
									{remoteNotes.map((note) => (
										<li key={note.id}>
											{note.title && (
												<strong className="text-[var(--vscode-foreground)]">{note.title}</strong>
											)}{" "}
											{note.description && (
												<Markdown components={markdownComponents}>{note.description}</Markdown>
											)}
											{note.actions && note.actions.length > 0 && onRemoteAction && (
												<div className="flex flex-wrap gap-3 mt-1.5">
													{note.actions.map((action) => (
														<button
															className="text-[var(--vscode-textLink-foreground)] hover:underline bg-transparent border-0 p-0 cursor-pointer"
															key={`${note.id}-${action.title}-${action.arg ?? ""}`}
															onClick={() => {
																onRemoteAction(action)
																onClose()
															}}
															type="button">
															{action.title}
														</button>
													))}
												</div>
											)}
										</li>
									))}
								</ul>
							</section>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default ReleaseNotesModal

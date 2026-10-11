import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ComponentProps } from "react"
import { useState } from "react"
import { ModularMarkdown } from "./ModularMarkdown"

const pastedBuildOutput = `Build output

src/features/chat/Composer.tsx:42:9 - error TS2322: Type 'undefined' is not assignable to type 'string'.
  40 | function Composer() {
  41 |   const value = readDraft()
  42 |   return <Input value={value} />

src/features/chat/Transcript.tsx:18:3 - warning: Long messages should preserve whitespace.
  16 | const message = getMessage()
  17 |
  18 | render(message)

Tests: 142 passed, 1 failed
Build failed with 1 error and 1 warning.`

function ExpandableUserMessage(props: ComponentProps<typeof ModularMarkdown>) {
	const [isExpanded, setIsExpanded] = useState(false)
	return (
		<div className="mx-auto max-w-2xl p-4">
			<ModularMarkdown
				{...props}
				isExpanded={isExpanded}
				onToggleExpand={() => setIsExpanded((expanded) => !expanded)}
			/>
		</div>
	)
}

const meta = {
	title: "Modular UI/Chat/Long User Message",
	component: ModularMarkdown,
	parameters: {
		layout: "fullscreen",
	},
} satisfies Meta<typeof ModularMarkdown>

export default meta
type Story = StoryObj<typeof meta>

export const PastedBuildOutput: Story = {
	args: {
		content: pastedBuildOutput,
		role: "user",
	},
	render: (args) => <ExpandableUserMessage {...args} />,
}

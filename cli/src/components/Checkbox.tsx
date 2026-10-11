import { theme } from "../constants/theme"
/**
 * Reusable Checkbox component for settings panels
 */

import { Text } from "ink"
import React from "react"

interface CheckboxProps {
	label: string
	checked: boolean
	isSelected?: boolean
}

export const Checkbox: React.FC<CheckboxProps> = ({ label, checked, isSelected = false }) => (
	<Text>
		<Text bold color={isSelected ? theme.primary : theme.subtle}>
			{isSelected ? "❯" : " "}{" "}
		</Text>
		<Text color={checked ? theme.success : theme.muted}>{checked ? "[✓]" : "[ ]"}</Text>
		<Text bold={isSelected} color={isSelected ? theme.strongText : theme.text}>
			{" "}
			{label}
		</Text>
	</Text>
)

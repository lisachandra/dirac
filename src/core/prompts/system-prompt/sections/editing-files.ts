import { getDelimiter } from "../../../../utils/line-hashing"

export const getEditingFilesInstructions = () => {
	const delimiter = getDelimiter()
	return `## EDITING FILES

- Use \`edit_ast\` for indexed symbol renames or whole-definition replacements, \`edit_file\` for partial edits, \`write_to_file\` for new or deliberately overwritten complete files, and \`execute_command\` only for mechanical bulk transformations.
- \`edit_file\` requires current complete \`ANCHOR${delimiter}CONTENT\` coordinates from \`read_file\`, \`search_files\`, or \`inspect_ast\` with \`include_anchors: true\`. Copy them verbatim, use the smallest range, keep anchors out of replacement text, reread after an anchor failure, and batch only non-overlapping edits.
`
}

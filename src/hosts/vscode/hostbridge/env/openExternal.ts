import { Empty, StringRequest } from "@shared/proto/dirac/common"
import * as vscode from "vscode"

export async function openExternal(request: StringRequest): Promise<Empty> {
	const uri = vscode.Uri.parse(request.value)
	const opened = await vscode.env.openExternal(uri)
	if (!opened) throw new Error("Could not open the URL in the browser")
	return Empty.create({})
}

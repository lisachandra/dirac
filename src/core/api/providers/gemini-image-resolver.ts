import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { Agent } from "undici"
import { fetch } from "@/shared/net"
import type { DiracContent, DiracImageContentBlock, DiracStorageMessage } from "@/shared/messages/content"

const MAX_GEMINI_INLINE_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_GEMINI_IMAGE_REDIRECTS = 5
const GEMINI_INLINE_IMAGE_MEDIA_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])

type GeminiInlineImageSource = Extract<DiracImageContentBlock["source"], { type: "base64" }>
type ResolvedAddress = { address: string; family: 4 | 6 }
type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>

interface InlineImageBudget {
	usedBytes: number
}

const resolveHostAddresses: ResolveHost = async (hostname) => {
	const addresses = await lookup(hostname, { all: true, verbatim: true })
	return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }))
}

function parseRemoteImageUrl(value: string): URL {
	const url = new URL(value)
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Gemini URL images require http or https: ${value}`)
	}
	if (url.username || url.password) {
		throw new Error(`Gemini URL images cannot include credentials: ${value}`)
	}
	return url
}

function isPublicIpv4(address: string): boolean {
	const [first, second] = address.split(".").map(Number)
	if (first === 0 || first === 10 || first === 127 || first >= 224) return false
	if (first === 100 && second >= 64 && second <= 127) return false
	if (first === 169 && second === 254) return false
	if (first === 172 && second >= 16 && second <= 31) return false
	if (first === 192 && (second === 0 || second === 168)) return false
	if (first === 198 && (second === 18 || second === 19 || second === 51)) return false
	if (first === 203 && second === 0) return false
	return true
}

function parseIpv6Words(address: string): number[] {
	const normalized = address.toLowerCase().split("%", 1)[0]
	const [left = "", right = ""] = normalized.split("::")
	const leftWords = left ? left.split(":").map((word) => Number.parseInt(word, 16)) : []
	const rightWords = right ? right.split(":").map((word) => Number.parseInt(word, 16)) : []
	return [...leftWords, ...Array(8 - leftWords.length - rightWords.length).fill(0), ...rightWords]
}

function isPublicIpv6(address: string): boolean {
	const words = parseIpv6Words(address)
	const [first, second, third, fourth, fifth, sixth, seventh, eighth] = words

	if (words.slice(0, 5).every((word) => word === 0) && sixth === 0xffff) {
		return isPublicIpv4(`${seventh >> 8}.${seventh & 0xff}.${eighth >> 8}.${eighth & 0xff}`)
	}
	if (words.slice(0, 6).every((word) => word === 0)) return false
	if (first === 0x64 && second === 0xff9b && third === 0 && fourth === 0 && fifth === 0 && sixth === 0) {
		return isPublicIpv4(`${seventh >> 8}.${seventh & 0xff}.${eighth >> 8}.${eighth & 0xff}`)
	}
	if (first === 0x64 && second === 0xff9b && third === 1) return false
	if (first === 0x100 && second === 0 && third === 0 && fourth === 0) return false
	if ((first & 0xfe00) === 0xfc00) return false
	if ((first & 0xffc0) === 0xfe80) return false
	if ((first & 0xff00) === 0xff00) return false
	if (first === 0x2001 && second <= 0x01ff) return false
	if (first === 0x2001 && second === 0x0db8) return false
	if (first === 0x2002) return false
	if (first === 0x3fff && (second & 0xf000) === 0) return false
	return true
}

function isPublicAddress(address: string): boolean {
	const family = isIP(address)
	if (family === 4) return isPublicIpv4(address)
	if (family === 6) return isPublicIpv6(address)
	return false
}

async function resolvePublicAddresses(url: URL, resolveHost: ResolveHost): Promise<ResolvedAddress[]> {
	const hostname = url.hostname.replace(/^\[|\]$/g, "")
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		throw new Error(`Gemini URL image cannot target a local address: ${url}`)
	}

	const literalFamily = isIP(hostname)
	const addresses = literalFamily ? [{ address: hostname, family: literalFamily as 4 | 6 }] : await resolveHost(hostname)
	if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
		throw new Error(`Gemini URL image cannot target a private or reserved address: ${url}`)
	}
	return addresses
}

function createPinnedDispatcher(addresses: ResolvedAddress[]): Agent {
	return new Agent({
		connect: {
			lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => {
				if (options?.all) {
					callback(null, addresses)
					return
				}
				callback(null, addresses[0].address, addresses[0].family)
			}) as any,
		},
	})
}

function readImageMediaType(response: Response, url: URL): GeminiInlineImageSource["media_type"] {
	const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
	if (!mediaType || !GEMINI_INLINE_IMAGE_MEDIA_TYPES.has(mediaType)) {
		throw new Error(`Gemini URL image '${url}' returned unsupported Content-Type '${mediaType || "missing"}'`)
	}
	return mediaType as GeminiInlineImageSource["media_type"]
}

function reserveInlineImageBytes(bytes: number, budget: InlineImageBudget): void {
	budget.usedBytes += bytes
	if (budget.usedBytes > MAX_GEMINI_INLINE_IMAGE_BYTES) {
		throw new Error(`Gemini inline images exceed the ${MAX_GEMINI_INLINE_IMAGE_BYTES}-byte request limit`)
	}
}

async function readBoundedImageBytes(response: Response, url: URL): Promise<Uint8Array> {
	if (!response.body) return new Uint8Array()

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let byteLength = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			byteLength += value.byteLength
			if (byteLength > MAX_GEMINI_INLINE_IMAGE_BYTES) {
				await reader.cancel()
				throw new Error(`Gemini URL image exceeds the ${MAX_GEMINI_INLINE_IMAGE_BYTES}-byte inline limit: ${url}`)
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}

	const bytes = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes
}

async function downloadGeminiImage(
	initialUrl: string,
	signal: AbortSignal | undefined,
	resolveHost: ResolveHost,
	budget: InlineImageBudget,
): Promise<GeminiInlineImageSource> {
	let url = parseRemoteImageUrl(initialUrl)

	for (let redirectCount = 0; redirectCount <= MAX_GEMINI_IMAGE_REDIRECTS; redirectCount++) {
		const addresses = await resolvePublicAddresses(url, resolveHost)
		const dispatcher = createPinnedDispatcher(addresses)
		try {
			const response = await fetch(url, {
				signal,
				redirect: "manual",
				dispatcher,
			} as RequestInit & { dispatcher: Agent })

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location")
				await response.body?.cancel()
				if (!location) throw new Error(`Gemini URL image redirect is missing a Location header: ${url}`)
				if (redirectCount === MAX_GEMINI_IMAGE_REDIRECTS) {
					throw new Error(`Gemini URL image exceeded ${MAX_GEMINI_IMAGE_REDIRECTS} redirects: ${initialUrl}`)
				}
				url = parseRemoteImageUrl(new URL(location, url).toString())
				continue
			}

			if (!response.ok) {
				await response.body?.cancel()
				throw new Error(`Gemini URL image download failed: ${response.status} ${response.statusText} (${url})`)
			}

			let mediaType: GeminiInlineImageSource["media_type"]
			try {
				mediaType = readImageMediaType(response, url)
			} catch (error) {
				await response.body?.cancel()
				throw error
			}

			const contentLength = response.headers.get("content-length")
			if (contentLength && Number(contentLength) > MAX_GEMINI_INLINE_IMAGE_BYTES) {
				await response.body?.cancel()
				throw new Error(`Gemini URL image exceeds the ${MAX_GEMINI_INLINE_IMAGE_BYTES}-byte inline limit: ${url}`)
			}

			const bytes = await readBoundedImageBytes(response, url)
			reserveInlineImageBytes(bytes.byteLength, budget)
			return {
				type: "base64",
				media_type: mediaType,
				data: Buffer.from(bytes).toString("base64"),
			}
		} finally {
			await dispatcher.close()
		}
	}

	throw new Error(`Gemini URL image could not be resolved: ${initialUrl}`)
}

async function resolveGeminiContentBlock(
	block: DiracContent,
	signal: AbortSignal | undefined,
	resolveHost: ResolveHost,
	budget: InlineImageBudget,
): Promise<DiracContent> {
	if (block.type === "image") {
		if (block.source.type === "base64") {
			reserveInlineImageBytes(Buffer.byteLength(block.source.data, "base64"), budget)
			return block
		}
		return {
			...block,
			source: await downloadGeminiImage(block.source.url, signal, resolveHost, budget),
		}
	}

	if (block.type === "tool_result" && Array.isArray(block.content)) {
		const content: DiracContent[] = []
		for (const contentBlock of block.content) {
			content.push(await resolveGeminiContentBlock(contentBlock as DiracContent, signal, resolveHost, budget))
		}
		return { ...block, content } as DiracContent
	}

	return block
}

export async function resolveGeminiImageSources(
	messages: DiracStorageMessage[],
	signal?: AbortSignal,
	resolveHost: ResolveHost = resolveHostAddresses,
): Promise<DiracStorageMessage[]> {
	const budget: InlineImageBudget = { usedBytes: 0 }
	const resolvedMessages: DiracStorageMessage[] = []
	for (const message of messages) {
		if (typeof message.content === "string") {
			resolvedMessages.push(message)
			continue
		}

		const content: DiracContent[] = []
		for (const block of message.content) {
			content.push(await resolveGeminiContentBlock(block, signal, resolveHost, budget))
		}
		resolvedMessages.push({ ...message, content })
	}
	return resolvedMessages
}

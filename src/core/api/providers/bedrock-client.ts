/**
 * Bedrock AWS auth + client construction. Extracted from `bedrock.ts` (FB-15b).
 * Takes the subset of provider options it needs so it never imports the handler.
 */
import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"

export interface AwsBedrockClientOptions {
	awsAuthentication?: string
	awsUseProfile?: boolean
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsProfile?: string
	awsRegion?: string
	awsBedrockApiKey?: string
	awsBedrockEndpoint?: string
}

type FromNodeProviderChainOptions = NonNullable<Parameters<typeof fromNodeProviderChain>[0]>

/** Either bearer-token auth (Bedrock Gateway API key) or resolved AK/SK credentials. */
type BedrockClientAuth =
	| Pick<BedrockRuntimeClientConfig, "token" | "authSchemePreference">
	| Pick<BedrockRuntimeClientConfig, "credentials">

/** Returns the AWS region to use for the given options, with a default fallback. */
function resolveRegion(options: AwsBedrockClientOptions, defaultRegion: string): string {
	return options.awsRegion || defaultRegion
}

/** Resolves AWS credentials from options or the node provider chain, without mutating env. */
export async function resolveAwsCredentials(
	options: AwsBedrockClientOptions,
	region: string,
	userAgentAppId: string,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }> {
	const useProfile =
		(options.awsAuthentication === undefined && options.awsUseProfile) ||
		options.awsAuthentication === "profile"
	if (!useProfile && options.awsAccessKey && options.awsSecretKey) {
		return {
			accessKeyId: options.awsAccessKey,
			secretAccessKey: options.awsSecretKey,
			sessionToken: options.awsSessionToken,
		}
	}
	const providerOptions: FromNodeProviderChainOptions = {
		clientConfig: { userAgentAppId, region },
	}
	if (useProfile) {
		providerOptions.ignoreCache = true
		if (options.awsProfile) providerOptions.profile = options.awsProfile
	}
	return fromNodeProviderChain(providerOptions)()
}

export async function createBedrockClient(
	options: AwsBedrockClientOptions,
	defaultRegion: string,
	userAgentAppId: string,
): Promise<BedrockRuntimeClient> {
	const region = resolveRegion(options, defaultRegion)

	let auth: BedrockClientAuth
	if (options.awsAuthentication === "apikey") {
		auth = {
			token: { token: options.awsBedrockApiKey ?? "" },
			authSchemePreference: ["httpBearerAuth"],
		}
	} else {
		auth = { credentials: await resolveAwsCredentials(options, region, userAgentAppId) }
	}

	return new BedrockRuntimeClient({
		userAgentAppId,
		region,
		...auth,
		...(options.awsBedrockEndpoint ? { endpoint: options.awsBedrockEndpoint } : {}),
	})
}

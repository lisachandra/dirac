import { theme } from "../../../constants/theme"
import React from "react"
import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import { COLORS } from "../../../constants/colors"

interface GithubAuthPageProps {
	githubAuthData: {
		verification_uri: string
		user_code: string
	}
}

export const GithubAuthPage: React.FC<GithubAuthPageProps> = ({ githubAuthData }) => (
	<Box flexDirection="column">
		<Box>
			<Text color={COLORS.primaryBlue}>
				<Spinner type="dots" />
			</Text>
			<Text color={theme.text}> Waiting for GitHub authorization...</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.text}>1. Open: </Text>
			<Text color={theme.info} bold underline>
				{githubAuthData.verification_uri}
			</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.text}>2. Enter code: </Text>
			<Text color={theme.warning} bold>
				{githubAuthData.user_code}
			</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>The browser should have opened automatically.</Text>
		</Box>
		<Box marginTop={1}>
			<Text color={theme.muted}>Esc to cancel</Text>
		</Box>
	</Box>
)

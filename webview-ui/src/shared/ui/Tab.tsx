import React, { createContext, forwardRef, HTMLAttributes, useCallback, useContext, useMemo } from "react"

type TabProps = HTMLAttributes<HTMLDivElement>

type TabSelectionContextValue = {
	value: string
	onValueChange: (value: string) => void
}

const TabSelectionContext = createContext<TabSelectionContextValue | undefined>(undefined)

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={`dirac-tab fixed inset-0 flex flex-col ${className}`} {...props}>
		{children}
	</div>
)

export const TabHeader = ({ className, children, ...props }: TabProps) => (
	<div className={`px-5 py-2.5 border-b border-(--vscode-panel-border) ${className || ""}`} {...props}>
		{children}
	</div>
)

export const TabContent = ({ className, children, ...props }: TabProps) => (
	<div className={`flex-1 overflow-auto ${className || ""}`} {...props}>
		{children}
	</div>
)

export const TabList = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement> & {
		value: string
		onValueChange: (value: string) => void
	}
>(({ children, className, value, onValueChange, onKeyDown, ...props }, ref) => {
	const orientation = props["aria-orientation"] || "horizontal"
	const selection = useMemo(() => ({ value, onValueChange }), [onValueChange, value])
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			onKeyDown?.(event)
			if (event.defaultPrevented) return
			const previousKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft"
			const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight"
			if (![previousKey, nextKey, "Home", "End"].includes(event.key)) return

			const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
			if (tabs.length === 0) return
			const currentIndex = tabs.findIndex((tab) => tab === document.activeElement)
			let nextIndex = currentIndex < 0 ? 0 : currentIndex
			if (event.key === previousKey) nextIndex = (nextIndex - 1 + tabs.length) % tabs.length
			if (event.key === nextKey) nextIndex = (nextIndex + 1) % tabs.length
			if (event.key === "Home") nextIndex = 0
			if (event.key === "End") nextIndex = tabs.length - 1
			event.preventDefault()
			tabs[nextIndex].focus()
			tabs[nextIndex].click()
		},
		[onKeyDown, orientation],
	)

	return (
		<div className={`flex ${className || ""}`} onKeyDown={handleKeyDown} ref={ref} role="tablist" {...props}>
			<TabSelectionContext.Provider value={selection}>{children}</TabSelectionContext.Provider>
		</div>
	)
})

export const TabTrigger = forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		value: string
	}
>(({ children, className, value, onClick, ...props }, ref) => {
	const selection = useContext(TabSelectionContext)
	if (!selection) throw new Error("TabTrigger must be used within TabList")

	const isSelected = selection.value === value
	const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		onClick?.(event)
		if (!event.defaultPrevented) selection.onValueChange(value)
	}

	return (
		<button
			{...props}
			aria-selected={isSelected}
			className={`focus:outline-none ${className || ""}`}
			data-value={value}
			onClick={handleClick}
			ref={ref}
			role="tab"
			tabIndex={isSelected ? 0 : -1}>
			{children}
		</button>
	)
})

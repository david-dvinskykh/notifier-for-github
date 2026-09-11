// The pull request header is rendered by GitHub's React app, whose class names
// are hashed per deploy, so only component attributes are used as anchors.
// The legacy selectors keep the button working on older GitHub Enterprise versions.
export const actionSelectors = '[data-component="PH_Actions"], .gh-header-actions';
export const titleSelectors = '[data-component="PH_Title"], .gh-header-title, .js-issue-title';
export const titleTextSelectors = '[data-component="PH_Title"] .markdown-title, .js-issue-title';

function isVisible(element) {
	return element.getClientRects().length > 0;
}

function isInStickyHeader(element) {
	return Boolean(element.closest('[class*="StickyPullRequestHeader"], [class*="stickyHeader"]'));
}

export function findButtonAnchor(root = document) {
	const actions = [...root.querySelectorAll(actionSelectors)]
		.filter(element => !isInStickyHeader(element) && isVisible(element));

	if (actions.length > 0) {
		return {element: actions[0], position: 'prepend'};
	}

	// The actions area is empty on pull requests you cannot edit, so the button
	// goes next to the title instead
	const titles = [...root.querySelectorAll(titleSelectors)]
		.filter(element => !isInStickyHeader(element) && element.parentElement);

	if (titles.length > 0) {
		return {element: titles[0].parentElement, position: 'append'};
	}
}

export function getPullRequestNumber(pathname) {
	const match = pathname.match(/\/pull\/(\d+)(?:\/|$)/);
	return match ? Number(match[1]) : undefined;
}

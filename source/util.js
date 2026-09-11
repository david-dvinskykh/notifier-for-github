import {getGitHubOrigin} from './lib/api.js';

export function isChrome(agentString = navigator.userAgent) {
	return agentString.includes('Chrome');
}

export function parseFullName(fullName) {
	const [, owner, repository] = fullName.match(/^([^/]*)(?:\/(.*))?/);
	return {owner, repository};
}

export async function isNotificationTargetPage(url) {
	const urlObject = new URL(url);

	if (urlObject.origin !== (await getGitHubOrigin())) {
		return false;
	}

	const pathname = urlObject.pathname.replace(/^\/|\/$/g, ''); // Remove trailing and leading slashes

	// For https://github.com/notifications and the beta https://github.com/notifications/beta
	if (pathname === 'notifications' || pathname === 'notifications/beta') {
		return true;
	}

	const repoPath = pathname.split('/').slice(2).join('/'); // Everything after `user/repo`

	// Issue, PR, commit paths, and per-repo notifications
	return /^(((issues|pull)\/\d+(\/(commits|files))?)|(commit\/.*)|(notifications$))/.test(repoPath);
}

export async function parsePullRequestUrl(url) {
	let urlObject;

	try {
		urlObject = new URL(url);
	} catch {
		return;
	}

	if (urlObject.origin !== (await getGitHubOrigin())) {
		return;
	}

	const match = urlObject.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
	if (!match) {
		return;
	}

	const [, owner, repository, number] = match;
	return {owner, repository, number: Number(number)};
}

export function parseLinkHeader(header) {
	const links = {};
	for (const part of (header || '').split(',')) {
		const [sectionUrl = '', sectionName = ''] = part.split(';');
		const url = sectionUrl.replace(/<(.+)>/, '$1').trim();
		const name = sectionName.replace(/rel="(.+)"/, '$1').trim();
		if (name && url) {
			links[name] = url;
		}
	}

	return links;
}

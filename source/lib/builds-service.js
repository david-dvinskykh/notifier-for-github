import browser from 'webextension-polyfill';
import optionsStorage from '../options-storage.js';
import {getPullRequest, getCombinedStatus, getCheckRuns, getGitHubOrigin, getTabUrl} from './api.js';
import {getBuildNotificationTitle, getBuildStateSummary} from './defaults.js';
import {log, logChecks, logError} from './logger.js';
import localStore from './local-store.js';
import {queryPermission} from './permissions-service.js';
import {openTab} from './tabs-service.js';

const watchedBuildsKey = 'watchedBuilds';

export const buildNotificationPrefix = 'github-notifier-build-';

export function getBuildKey({owner, repository, number}) {
	return `${owner}/${repository}#${number}`;
}

export async function getWatchedBuilds() {
	return await localStore.get(watchedBuildsKey) || {};
}

async function setWatchedBuilds(builds) {
	return localStore.set(watchedBuildsKey, builds);
}

export async function isWatchingBuild(pullRequest) {
	const builds = await getWatchedBuilds();
	return Boolean(builds[getBuildKey(pullRequest)]);
}

export async function getWatchedBuildCount() {
	return Object.keys(await getWatchedBuilds()).length;
}

// The combined status API and the check runs API describe the same thing with
// different vocabularies, so both are normalized to `pending`/`success`/`failure`
export function getStatusState(state) {
	if (state === 'success') {
		return 'success';
	}

	if (state === 'failure' || state === 'error') {
		return 'failure';
	}

	return 'pending';
}

export function getCheckRunState({status, conclusion}) {
	if (status !== 'completed') {
		return 'pending';
	}

	if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') {
		return 'success';
	}

	return 'failure';
}

export function summarizeChecks({statuses = [], checkRuns = []}) {
	const checks = [
		...statuses.map(({context, state, target_url: targetUrl}) => ({
			name: context,
			state: getStatusState(state),
			url: targetUrl
		})),
		...checkRuns.map(({name, status, conclusion, html_url: htmlUrl}) => ({
			name,
			state: getCheckRunState({status, conclusion}),
			url: htmlUrl
		}))
	];

	const failed = checks.filter(({state}) => state === 'failure');
	const pending = checks.filter(({state}) => state === 'pending');
	const passed = checks.filter(({state}) => state === 'success');

	let state = 'success';
	if (checks.length === 0 || pending.length > 0) {
		state = 'pending';
	} else if (failed.length > 0) {
		state = 'failure';
	}

	return {
		state,
		checks,
		total: checks.length,
		passed: passed.length,
		failed: failed.length,
		pending: pending.length,
		failedNames: failed.map(({name}) => name)
	};
}

export async function getBuildState({owner, repository, reference}) {
	const [combinedStatus, checkRunsResponse] = await Promise.all([
		getCombinedStatus({owner, repository, reference}),
		getCheckRuns({owner, repository, reference})
	]);

	return summarizeChecks({
		statuses: combinedStatus.statuses,
		checkRuns: checkRunsResponse.check_runs
	});
}

export async function getPullRequestUrl({owner, repository, number}) {
	return `${await getGitHubOrigin()}/${owner}/${repository}/pull/${number}`;
}

export async function watchBuild(pullRequest) {
	const {owner, repository, number} = pullRequest;
	const key = getBuildKey(pullRequest);
	const builds = await getWatchedBuilds();

	const build = {
		owner,
		repository,
		number,
		title: pullRequest.title,
		url: await getPullRequestUrl(pullRequest),
		state: 'pending',
		watchedAt: Date.now()
	};

	try {
		const {title, head, html_url: htmlUrl} = await getPullRequest(pullRequest);
		build.title = title || build.title;
		build.sha = head && head.sha;
		build.url = htmlUrl || build.url;
	} catch (error) {
		// The build is still watched, the next check picks up the details
		logError(`${key}: could not read the pull request (${error.message})`);
	}

	builds[key] = build;
	await setWatchedBuilds(builds);

	log(`Watching the checks of ${key}${build.sha ? ` at ${build.sha.slice(0, 7)}` : ''}`);

	return build;
}

export async function unwatchBuild(pullRequest) {
	const key = getBuildKey(pullRequest);
	const builds = await getWatchedBuilds();
	delete builds[key];
	await setWatchedBuilds(builds);

	log(`Stopped watching the checks of ${key}`);
}

export async function toggleBuildWatch(pullRequest) {
	if (await isWatchingBuild(pullRequest)) {
		await unwatchBuild(pullRequest);
		return {watching: false};
	}

	await watchBuild(pullRequest);
	return {watching: true};
}

export function getBuildNotificationObject(build, summary) {
	return {
		title: getBuildNotificationTitle(summary.state),
		iconUrl: browser.runtime.getURL('icon-notif.png'),
		type: 'basic',
		message: `${getBuildKey(build)} · ${build.title || ''}`.trim(),
		contextMessage: getBuildStateSummary(summary)
	};
}

export async function showBuildNotification(build, summary, {ignoreSetting = false} = {}) {
	const {playNotifSound, notifyBuildResults} = await optionsStorage.getAll();

	if (!notifyBuildResults && !ignoreSetting) {
		log('Notifications for check results are disabled in the options, nothing shown');
		return {shown: false, reason: 'disabled'};
	}

	if (playNotifSound) {
		await browser.runtime.sendMessage({
			action: 'play',
			options: {
				source: 'sounds/bell.ogg',
				volume: 1
			}
		});
	}

	if (!await queryPermission('notifications')) {
		log('The notifications permission is missing, nothing shown');
		return {shown: false, reason: 'permission'};
	}

	const notificationId = `${buildNotificationPrefix}${getBuildKey(build)}`;
	await browser.notifications.create(notificationId, getBuildNotificationObject(build, summary));
	await localStore.set(notificationId, {url: build.checksUrl || `${build.url}/checks`});

	return {shown: true};
}

export async function showTestBuildNotification() {
	const build = {
		owner: 'octocat',
		repository: 'hello-world',
		number: 1,
		title: 'This is what a check result looks like',
		checksUrl: await getTabUrl()
	};

	const summary = summarizeChecks({
		statuses: [{context: 'ci/lint', state: 'success'}],
		checkRuns: [
			{name: 'test', status: 'completed', conclusion: 'success'},
			{name: 'build', status: 'completed', conclusion: 'failure'}
		]
	});

	log('Sending a test notification');
	return showBuildNotification(build, summary, {ignoreSetting: true});
}

export async function openBuildNotification(notificationId) {
	const notification = await localStore.get(notificationId);

	await browser.notifications.clear(notificationId);
	await localStore.remove(notificationId);

	if (notification && notification.url) {
		await openTab(notification.url);
	}
}

async function checkWatchedBuild(build) {
	const key = getBuildKey(build);
	const {head, state: pullRequestState, title, html_url: htmlUrl} = await getPullRequest(build);
	const reference = head && head.sha;

	if (!reference) {
		log(`${key}: the pull request has no head commit, retrying on the next run`);
		return build;
	}

	if (build.sha && build.sha !== reference) {
		log(`${key}: new head commit ${reference.slice(0, 7)}, watching its checks instead`);
	}

	// A new push restarts the checks, so the previous result is not reported
	const updatedBuild = {
		...build,
		title: title || build.title,
		url: htmlUrl || build.url,
		sha: reference
	};

	const summary = await getBuildState({
		owner: build.owner,
		repository: build.repository,
		reference
	});

	logChecks(`${key} at ${reference.slice(0, 7)}`, summary.checks, summary);

	if (summary.state === 'pending' && pullRequestState === 'open') {
		return {...updatedBuild, state: 'pending'};
	}

	log(`${key}: ${getBuildStateSummary(summary)} — ${getBuildNotificationTitle(summary.state).toLowerCase()}`);

	await showBuildNotification(updatedBuild, summary);
	return undefined;
}

export async function checkWatchedBuilds() {
	const builds = await getWatchedBuilds();
	const keys = Object.keys(builds);

	if (keys.length === 0) {
		return;
	}

	log(`Checking ${keys.length} watched pull request${keys.length === 1 ? '' : 's'}: ${keys.join(', ')}`);

	const updatedBuilds = {};

	for (const key of keys) {
		try {
			const build = await checkWatchedBuild(builds[key]);
			if (build) {
				updatedBuilds[key] = build;
			}
		} catch (error) {
			// Keep watching, a failed request is retried on the next run
			logError(`${key}: could not read the checks (${error.message}), retrying on the next run`);
			updatedBuilds[key] = builds[key];
		}
	}

	await setWatchedBuilds(updatedBuilds);
}

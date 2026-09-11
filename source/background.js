import browser from 'webextension-polyfill';
import delay from 'delay';
import optionsStorage from './options-storage.js';
import localStore from './lib/local-store.js';
import {openTab} from './lib/tabs-service.js';
import {queryPermission} from './lib/permissions-service.js';
import {getNotificationCount, getTabUrl} from './lib/api.js';
import {renderBuildResult, renderCount, renderError, renderWarning} from './lib/badge.js';
import {checkNotifications, openNotification} from './lib/notifications-service.js';
import {
	buildNotificationPrefix,
	checkWatchedBuilds,
	clearPendingBuildResult,
	getPendingBuildResult,
	getWatchedBuildCount,
	isWatchingBuild,
	openBuildNotification,
	showTestBuildNotification,
	toggleBuildWatch
} from './lib/builds-service.js';
import {isChrome, isNotificationTargetPage, parsePullRequestUrl} from './util.js';

const updateAlarm = 'update';
const buildsAlarm = 'builds';

async function scheduleNextAlarm(interval) {
	const intervalSetting = await localStore.get('interval') || 60;
	const intervalValue = interval || 60;

	if (intervalSetting !== intervalValue) {
		localStore.set('interval', intervalValue);
	}

	// Delay less than 1 minute will cause a warning
	const delayInMinutes = Math.max(Math.ceil(intervalValue / 60), 1);

	browser.alarms.clear(updateAlarm);
	browser.alarms.create(updateAlarm, {delayInMinutes});
}

async function scheduleBuildsAlarm() {
	// The alarm is cleared before a new one is created, otherwise the pending
	// clear can remove the alarm that was just scheduled
	await browser.alarms.clear(buildsAlarm);

	if (await getWatchedBuildCount() === 0) {
		return;
	}

	const {buildPollInterval} = await optionsStorage.getAll();

	// Alarms cannot be scheduled more often than once a minute
	const periodInMinutes = Math.max(Number(buildPollInterval) / 60, 1) || 1;

	browser.alarms.create(buildsAlarm, {periodInMinutes, delayInMinutes: periodInMinutes});
}

async function handleLastModified(newLastModified) {
	const lastModified = await localStore.get('lastModified') || new Date(0).toUTCString();

	// Something has changed since we last accessed, display any new notifications
	if (newLastModified !== lastModified) {
		const {showDesktopNotif, playNotifSound} = await optionsStorage.getAll();
		if (showDesktopNotif === true || playNotifSound === true) {
			await checkNotifications(lastModified);
		}

		await localStore.set('lastModified', newLastModified);
	}
}

// A finished build owns the toolbar icon until it is opened, so the result is
// never lost when desktop notifications do not arrive
async function renderBadge(fallback) {
	const pendingResult = await getPendingBuildResult();

	if (pendingResult) {
		renderBuildResult(pendingResult);
		return;
	}

	fallback();
}

async function updateNotificationCount() {
	const response = await getNotificationCount();
	const {count, interval, lastModified} = response;

	await renderBadge(() => renderCount(count));

	scheduleNextAlarm(interval);
	handleLastModified(lastModified);
}

async function handleError(error) {
	scheduleNextAlarm();
	await renderBadge(() => renderError(error));
}

async function handleOfflineStatus() {
	scheduleNextAlarm();
	await renderBadge(() => renderWarning('offline'));
}

async function update() {
	if (navigator.onLine) {
		try {
			await updateNotificationCount();
		} catch (error) {
			await handleError(error);
		}
	} else {
		await handleOfflineStatus();
	}
}

async function canNotifyBuildResults() {
	const {notifyBuildResults} = await optionsStorage.getAll();

	if (!notifyBuildResults) {
		return false;
	}

	return queryPermission('notifications');
}

async function onAlarm(alarm) {
	if (alarm && alarm.name === buildsAlarm) {
		await checkWatchedBuilds();
		await scheduleBuildsAlarm();
		await renderBadge(() => {});

		return;
	}

	await update();
}

async function toggleBuildWatchForTab(tab) {
	if (!tab || !tab.url) {
		return;
	}

	const pullRequest = await parsePullRequestUrl(tab.url);
	if (!pullRequest) {
		return;
	}

	const {watching} = await toggleBuildWatch({...pullRequest, title: tab.title});
	await scheduleBuildsAlarm();

	try {
		await browser.tabs.sendMessage(tab.id, {action: 'build-watch-changed', watching});
	} catch {
		// The tab has no content script, the badge state is enough
	}
}

async function onCommand(command) {
	if (command !== 'watch-build') {
		return;
	}

	const [tab] = await browser.tabs.query({active: true, currentWindow: true});
	if (!tab) {
		return;
	}

	if (tab.url) {
		await toggleBuildWatchForTab(tab);
		return;
	}

	// Without the `tabs` permission the URL of the tab is not readable here,
	// so the page is asked to start the toggle itself
	try {
		await browser.tabs.sendMessage(tab.id, {action: 'request-build-watch-toggle'});
	} catch {
		// No content script on this page, nothing to watch
	}
}

async function handleBrowserActionClick() {
	const pendingResult = await getPendingBuildResult();

	if (pendingResult) {
		await clearPendingBuildResult();
		await openTab(pendingResult.url);
		await update();
		return;
	}

	await openTab(await getTabUrl());
}

function handleInstalled(details) {
	if (details.reason === 'install') {
		browser.runtime.openOptionsPage();
	}
}

async function handleUpdateMessage() {
	await addHandlers();
	await update();
}

async function handleToggleBuildWatch(message, sender) {
	// The page the message came from decides which pull request is watched,
	// so a page on another GitHub instance cannot watch builds on this one
	const pullRequest = await parsePullRequestUrl(sender.url);
	if (!pullRequest) {
		return {watching: false};
	}

	const {title} = message.pullRequest || {};
	const result = await toggleBuildWatch({...pullRequest, title});
	await scheduleBuildsAlarm();

	if (result.watching && !await canNotifyBuildResults()) {
		// Watching is pointless until the results can be shown
		browser.runtime.openOptionsPage();
	}

	return result;
}

async function handleTestNotification() {
	try {
		const result = await showTestBuildNotification();
		await renderBadge(() => {});
		return result;
	} catch (error) {
		console.error(error);
		return {shown: false, reason: 'error', message: error.message};
	}
}

async function handleBuildWatchState(sender) {
	const pullRequest = await parsePullRequestUrl(sender.url);
	if (!pullRequest) {
		return {watching: false};
	}

	return {watching: await isWatchingBuild(pullRequest)};
}

function onMessage(message, sender) {
	switch (message.action) {
		case 'update': {
			return handleUpdateMessage();
		}

		case 'toggle-build-watch': {
			return handleToggleBuildWatch(message, sender);
		}

		case 'build-watch-state': {
			return handleBuildWatchState(sender);
		}

		case 'test-build-notification': {
			return handleTestNotification();
		}

		// Other messages, like the offscreen audio playback, are handled elsewhere
		default: {
			return undefined;
		}
	}
}

async function onTabUpdated(tabId, changeInfo, tab) {
	if (changeInfo.status !== 'complete') {
		return;
	}

	if (await isNotificationTargetPage(tab.url)) {
		await delay(1000);
		await update();
	}
}

function onNotificationClick(id) {
	if (id.startsWith(buildNotificationPrefix)) {
		openBuildNotification(id);
		return;
	}

	openNotification(id);
}

async function createOffscreenDocument() {
	if (await browser.offscreen.hasDocument()) {
		return;
	}

	await browser.offscreen.createDocument({
		url: 'offscreen.html',
		reasons: ['AUDIO_PLAYBACK'],
		justification: 'To play an audio chime indicating notifications'
	});
}

async function addHandlers() {
	const {updateCountOnNavigation} = await optionsStorage.getAll();

	if (await queryPermission('notifications')) {
		browser.notifications.onClicked.addListener(onNotificationClick);
	}

	if (await queryPermission('tabs')) {
		if (updateCountOnNavigation) {
			browser.tabs.onUpdated.addListener(onTabUpdated);
		} else {
			browser.tabs.onUpdated.removeListener(onTabUpdated);
		}
	}
}

async function init() {
	browser.alarms.onAlarm.addListener(onAlarm);
	scheduleNextAlarm();
	scheduleBuildsAlarm();

	browser.runtime.onMessage.addListener(onMessage);
	browser.runtime.onInstalled.addListener(handleInstalled);

	// Chrome specific API
	if (isChrome(navigator.userAgent)) {
		browser.permissions.onAdded.addListener(addHandlers);
	}

	browser.action.onClicked.addListener(handleBrowserActionClick);
	browser.commands.onCommand.addListener(onCommand);

	await createOffscreenDocument();
	addHandlers();
	update();
}

init();

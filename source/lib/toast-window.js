import browser from 'webextension-polyfill';
import {log, logError} from './logger.js';
import localStore from './local-store.js';

// A window of the browser itself, which is shown whatever the notification
// settings of the browser and of the operating system are
const toastPage = 'toast.html';
const windowIdKey = 'resultWindowId';
const width = 380;
const height = 190;
const margin = 24;

function getToastUrl(result) {
	const parameters = new URLSearchParams({
		key: result.key || '',
		state: result.state || '',
		title: result.title || '',
		summary: result.summary || '',
		url: result.url || ''
	});

	return `${browser.runtime.getURL(toastPage)}?${parameters.toString()}`;
}

async function getPlacement() {
	try {
		const {left, top, width: parentWidth} = await browser.windows.getLastFocused({});

		if (typeof left === 'number' && typeof parentWidth === 'number') {
			return {
				left: Math.max(0, left + parentWidth - width - margin),
				top: Math.max(0, (top || 0) + margin)
			};
		}
	} catch {
		// Without a placement the browser picks one
	}

	return {};
}

// Several pull requests can finish in the same run, so an open window is
// reused instead of stacking one window per result
async function sendToOpenWindow(result) {
	const openId = await localStore.get(windowIdKey);

	if (openId === undefined || openId === null) {
		return false;
	}

	try {
		const response = await browser.runtime.sendMessage({action: 'build-result-window', result});

		if (!response || !response.received) {
			throw new Error('no window listening');
		}

		await browser.windows.update(openId, {focused: true, drawAttention: true});
		return true;
	} catch {
		await localStore.remove(windowIdKey);
		return false;
	}
}

export async function showResultWindow(result) {
	if (!browser.windows || !browser.windows.create) {
		logError('This browser cannot open notification windows');
		return {shown: false, reason: 'unsupported'};
	}

	if (await sendToOpenWindow(result)) {
		log('Result added to the open notification window');
		return {shown: true, via: 'window'};
	}

	const createData = {
		url: getToastUrl(result),
		type: 'popup',
		width,
		height,
		focused: true
	};

	let created;
	try {
		created = await browser.windows.create({...createData, ...await getPlacement()});
	} catch (error) {
		// The corner of the parent window can lie outside the visible screen,
		// on a second monitor for example, and the browser rejects such bounds
		logError(`Could not place the notification window (${error.message}), opening it without a position`);

		try {
			created = await browser.windows.create(createData);
		} catch (secondError) {
			logError(`Could not open the notification window (${secondError.message})`);
			return {shown: false, reason: 'error', message: secondError.message};
		}
	}

	await localStore.set(windowIdKey, created.id);
	log(`Notification window opened for ${result.key}`);
	return {shown: true, via: 'window'};
}

export async function forgetResultWindow(windowId) {
	if (await localStore.get(windowIdKey) === windowId) {
		await localStore.remove(windowIdKey);
	}
}

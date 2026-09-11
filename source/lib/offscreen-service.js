import browser from 'webextension-polyfill';
import {logError} from './logger.js';

const offscreenDocument = {
	url: 'offscreen.html',
	reasons: ['AUDIO_PLAYBACK'],
	justification: 'To play an audio chime indicating notifications'
};

async function hasDocument() {
	try {
		return await browser.offscreen.hasDocument();
	} catch {
		return false;
	}
}

// The service worker is restarted on every alarm and the document does not
// always survive with it, so it is created on demand instead of once at startup
export async function ensureOffscreenDocument() {
	// Firefox has no offscreen documents
	if (!browser.offscreen) {
		return false;
	}

	if (await hasDocument()) {
		return true;
	}

	try {
		await browser.offscreen.createDocument(offscreenDocument);
		return true;
	} catch (error) {
		// Another call may have created it in the meantime
		if (await hasDocument()) {
			return true;
		}

		logError(`Could not create the offscreen document (${error.message})`);
		return false;
	}
}

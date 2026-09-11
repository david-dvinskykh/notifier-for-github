import browser from 'webextension-polyfill';
import optionsStorage from './options-storage.js';
import initRepositoriesForm from './repositories.js';
import {requestPermission} from './lib/permissions-service.js';

document.addEventListener('DOMContentLoaded', async () => {
	try {
		await initOptionsForm();
		await initRepositoriesForm();
		initTestNotification();
		initGlobalSyncListener();
	} catch (error) {
		console.error(error);
	}
});

function initGlobalSyncListener() {
	document.addEventListener('options-sync:form-synced', () => {
		browser.runtime.sendMessage({action: 'update'});
	});
}

function initTestNotification() {
	const button = document.querySelector('#test-notification');
	const result = document.querySelector('#test-notification-result');

	const messages = {
		permission: 'The notifications permission was not granted.',
		blocked: 'Notifications from extensions are turned off in the browser or in the operating system. Enable them for Chrome and try again.',
		disabled: 'Notifications for check results are switched off above.'
	};

	button.addEventListener('click', async () => {
		result.textContent = '';

		// `permissions.request` only works inside the click itself, so nothing
		// may be awaited before it
		const permissionRequest = requestPermission('notifications');
		button.disabled = true;

		try {
			if (!await permissionRequest) {
				result.textContent = ` ${messages.permission}`;
				return;
			}

			const response = await browser.runtime.sendMessage({action: 'test-build-notification'});

			if (response && response.via === 'window') {
				result.textContent = ' A notification window was opened.';
				return;
			}

			if (response && response.shown) {
				result.textContent = response.accepted ?
					' The browser accepted the notification. If nothing appeared on screen, your operating system is hiding notifications from the browser; the toolbar icon now shows the result instead.' :
					' Sent, but the browser does not list it. See the extension log.';
				return;
			}

			const reason = response && response.reason;
			result.textContent = ` ${messages[reason] || (response && response.message) || 'The browser did not show it, see the extension log for the reason.'}`;
		} catch (error) {
			console.error(error);
			result.textContent = ` Failed: ${error.message}`;
		} finally {
			button.disabled = false;
		}
	});
}

function checkRelatedInputStates(inputElement) {
	if (inputElement.name === 'showDesktopNotif') {
		const filterCheckbox = document.querySelector('[name="filterNotifications"]');
		filterCheckbox.disabled = !inputElement.checked;
	}
}

async function initOptionsForm() {
	const form = document.querySelector('#options-form');
	await optionsStorage.syncForm(form);

	for (const inputElement of form.querySelectorAll('[name]')) {
		checkRelatedInputStates(inputElement);

		if (inputElement.dataset.requestPermission) {
			inputElement.parentElement.addEventListener('click', async event => {
				if (event.target !== inputElement) {
					return;
				}

				checkRelatedInputStates(inputElement);

				if (inputElement.checked) {
					inputElement.checked = await requestPermission(inputElement.dataset.requestPermission);

					// Programatically changing input value does not trigger input events, so save options manually
					optionsStorage.set({
						[inputElement.name]: inputElement.checked
					});
				}
			});
		}
	}
}

// Detect Chromium based Microsoft Edge for some CSS styling
if (navigator.userAgent.includes('Edg/')) {
	document.documentElement.classList.add('is-edgium');
}

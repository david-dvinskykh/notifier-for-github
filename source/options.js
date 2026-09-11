import browser from 'webextension-polyfill';
import optionsStorage from './options-storage.js';
import initRepositoriesForm from './repositories.js';
import {queryPermission, requestPermission} from './lib/permissions-service.js';

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

	button.addEventListener('click', async () => {
		button.disabled = true;
		result.textContent = '';

		try {
			if (!await queryPermission('notifications') && !await requestPermission('notifications')) {
				result.textContent = ' The notifications permission was not granted.';
				return;
			}

			const response = await browser.runtime.sendMessage({action: 'test-build-notification'});
			result.textContent = response && response.shown ?
				' Sent. If nothing appeared, check the notification settings of your operating system.' :
				' The browser did not show it, see the extension log for the reason.';
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

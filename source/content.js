import browser from 'webextension-polyfill';
import {findButtonAnchor, getPullRequestNumber as parseNumber, titleTextSelectors} from './lib/pr-header.js';

const buttonClass = 'notifier-for-github-watch-build';

function getPullRequestNumber() {
	return parseNumber(location.pathname);
}

function getPullRequestTitle() {
	const titleElement = document.querySelector(titleTextSelectors);
	return titleElement ? titleElement.textContent.trim() : '';
}

function renderButton(button, watching) {
	button.textContent = watching ? 'Unwatch checks' : 'Watch checks';
	button.title = watching ?
		'Stop watching the checks of this pull request' :
		'Get a desktop notification when the checks of this pull request finish';
	button.setAttribute('aria-pressed', String(watching));
	button.style.color = watching ? 'var(--fgColor-accent, #0969da)' : 'var(--fgColor-default, #1f2328)';
}

async function sendMessage(action) {
	const number = getPullRequestNumber();
	if (!number) {
		return;
	}

	const [owner, repository] = location.pathname.split('/').slice(1, 3);

	return browser.runtime.sendMessage({
		action,
		pullRequest: {
			owner,
			repository,
			number,
			title: getPullRequestTitle()
		}
	});
}

async function toggleWatch(button) {
	button.disabled = true;

	try {
		const response = await sendMessage('toggle-build-watch');
		renderButton(button, Boolean(response && response.watching));
	} catch (error) {
		console.error(error);
	} finally {
		button.disabled = false;
	}
}

function createButton() {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = `btn btn-sm ${buttonClass}`;

	// Inline styles keep the button readable in both GitHub interfaces,
	// whose button classes differ
	Object.assign(button.style, {
		alignSelf: 'center',
		marginLeft: '8px',
		padding: '3px 12px',
		fontSize: '12px',
		fontWeight: '500',
		lineHeight: '20px',
		whiteSpace: 'nowrap',
		border: '1px solid var(--borderColor-default, #d1d9e0)',
		borderRadius: 'var(--borderRadius-medium, 6px)',
		background: 'var(--bgColor-default, #ffffff)',
		cursor: 'pointer'
	});

	button.addEventListener('click', () => toggleWatch(button));
	renderButton(button, false);
	return button;
}

async function addButton() {
	if (!getPullRequestNumber() || document.querySelector(`.${buttonClass}`)) {
		return;
	}

	const anchor = findButtonAnchor();
	if (!anchor) {
		return;
	}

	const button = createButton();
	anchor.element[anchor.position](button);

	const response = await sendMessage('build-watch-state');
	renderButton(button, Boolean(response && response.watching));
}

function onMessage(message) {
	if (message.action === 'build-watch-changed') {
		const button = document.querySelector(`.${buttonClass}`);
		if (button) {
			renderButton(button, Boolean(message.watching));
		}

		return;
	}

	// The keyboard shortcut is handled here because the page URL is the only
	// source the background page trusts to identify the pull request
	if (message.action === 'request-build-watch-toggle') {
		const button = document.querySelector(`.${buttonClass}`);
		if (button) {
			toggleWatch(button);
		} else if (getPullRequestNumber()) {
			sendMessage('toggle-build-watch');
		}
	}
}

let scheduled = false;
function scheduleAddButton() {
	if (scheduled) {
		return;
	}

	scheduled = true;
	setTimeout(() => {
		scheduled = false;
		addButton();
	}, 200);
}

function init() {
	addButton();

	// GitHub renders the header after the script runs and navigates without
	// full page loads, so the header has to be watched for
	const observer = new MutationObserver(scheduleAddButton);
	observer.observe(document.body, {childList: true, subtree: true});

	document.addEventListener('turbo:load', scheduleAddButton);
	document.addEventListener('pjax:end', scheduleAddButton);
	browser.runtime.onMessage.addListener(onMessage);
}

init();

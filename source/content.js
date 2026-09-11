import browser from 'webextension-polyfill';

const buttonClass = 'notifier-for-github-watch-build';

function getPullRequestNumber() {
	const match = location.pathname.match(/\/pull\/(\d+)(?:\/|$)/);
	return match ? Number(match[1]) : undefined;
}

function getPullRequestTitle() {
	const titleElement = document.querySelector('.js-issue-title, [data-testid="issue-title"]');
	return titleElement ? titleElement.textContent.trim() : '';
}

function renderButton(button, watching) {
	button.textContent = watching ? 'Unwatch checks' : 'Watch checks';
	button.title = watching ?
		'Stop watching the checks of this pull request' :
		'Get a desktop notification when the checks of this pull request finish';
	button.classList.toggle('selected', watching);
	button.setAttribute('aria-pressed', String(watching));
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

async function onButtonClick(event) {
	const button = event.currentTarget;
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
	button.addEventListener('click', onButtonClick);
	renderButton(button, false);
	return button;
}

async function addButton() {
	if (!getPullRequestNumber() || document.querySelector(`.${buttonClass}`)) {
		return;
	}

	const actions = document.querySelector('.gh-header-actions');
	if (!actions) {
		return;
	}

	const button = createButton();
	actions.prepend(button);

	const response = await sendMessage('build-watch-state');
	renderButton(button, Boolean(response && response.watching));
}

function onMessage(message) {
	if (message.action !== 'build-watch-changed') {
		return;
	}

	const button = document.querySelector(`.${buttonClass}`);
	if (button) {
		renderButton(button, Boolean(message.watching));
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

	// GitHub navigates without full page loads, so the header is re-rendered
	const observer = new MutationObserver(scheduleAddButton);
	observer.observe(document.body, {childList: true, subtree: true});

	document.addEventListener('turbo:load', scheduleAddButton);
	document.addEventListener('pjax:end', scheduleAddButton);
	browser.runtime.onMessage.addListener(onMessage);
}

init();

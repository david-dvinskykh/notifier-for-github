import browser from 'webextension-polyfill';

// The window closes on its own, the bar shows how much time is left
const lifetime = 10_000;

const stateColors = {
	success: '#1a7f37',
	failure: '#cf222e'
};

const elements = {
	accent: document.querySelector('#accent'),
	state: document.querySelector('#state'),
	repository: document.querySelector('#repository'),
	summary: document.querySelector('#summary'),
	count: document.querySelector('#count'),
	bar: document.querySelector('#bar')
};

let checksUrl = '';
let deadline = 0;
let queued = 0;
let ticker;

function readResultFromLocation() {
	const parameters = new URLSearchParams(location.search);
	return {
		key: parameters.get('key') || '',
		state: parameters.get('state') || '',
		title: parameters.get('title') || 'Checks finished',
		summary: parameters.get('summary') || '',
		url: parameters.get('url') || ''
	};
}

function render(result) {
	checksUrl = result.url || '';
	document.documentElement.style.setProperty('--accent', stateColors[result.state] || '#0969da');

	elements.state.textContent = result.title;
	elements.repository.textContent = result.key;
	elements.summary.textContent = result.summary;
	elements.count.textContent = queued > 0 ? `+${queued} more` : '';
	document.title = result.title;
}

function restartCountdown() {
	deadline = Date.now() + lifetime;

	if (ticker) {
		return;
	}

	ticker = setInterval(() => {
		const left = deadline - Date.now();
		elements.bar.style.width = `${Math.max(0, (left / lifetime) * 100)}%`;

		if (left <= 0) {
			window.close();
		}
	}, 250);
}

document.addEventListener('click', async () => {
	if (checksUrl) {
		await browser.tabs.create({url: checksUrl});
	}

	window.close();
});

// Another pull request finished while this window was open
browser.runtime.onMessage.addListener(async message => {
	if (!message || message.action !== 'build-result-window') {
		return;
	}

	queued++;
	render(message.result);
	restartCountdown();

	return {received: true};
});

render(readResultFromLocation());
restartCountdown();

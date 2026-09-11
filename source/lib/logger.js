const prefix = '[Notifier for GitHub]';

export function log(...arguments_) {
	console.log(prefix, ...arguments_);
}

export function logError(...arguments_) {
	console.error(prefix, ...arguments_);
}

// Console groups keep one poll of one pull request readable in the service
// worker console, where every watched pull request logs on every run
export function logChecks(label, checks, summary) {
	const rows = checks.map(({name, state, url}) => ({name, state, url}));

	console.groupCollapsed(`${prefix} ${label} — ${summary.state} (${summary.passed} passed, ${summary.failed} failed, ${summary.pending} running)`);

	if (rows.length > 0) {
		console.table(rows);
	} else {
		console.log('No checks reported for this commit yet');
	}

	console.groupEnd();
}

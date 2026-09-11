import test from 'ava';
import sinon from 'sinon';

import * as builds from '../source/lib/builds-service.js';

const pullRequest = {
	owner: 'user',
	repository: 'repo',
	number: 42,
	title: 'Add a feature'
};

const pullRequestResponse = {
	title: 'Add a feature',
	state: 'open',
	head: {sha: 'abc123'},
	html_url: 'https://github.com/user/repo/pull/42' // eslint-disable-line camelcase
};

function fakeApiResponses(responses) {
	global.fetch = sinon.stub().callsFake(url => {
		const key = Object.keys(responses).find(endpoint => url.includes(endpoint));
		return {
			status: 200,
			statusText: 'OK',
			headers: new Map(),
			async json() {
				return responses[key];
			}
		};
	});
}

test.beforeEach(t => {
	t.context.store = {};

	browser.flush();

	browser.storage.sync.get.callsFake((key, cb) => {
		cb({
			options: {
				token: 'a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0',
				rootUrl: 'https://github.com/',
				notifyBuildResults: true,
				playNotifSound: false
			}
		});
	});

	browser.storage.local.get.callsFake(async key => {
		return key in t.context.store ? {[key]: t.context.store[key]} : {};
	});

	browser.storage.local.set.callsFake(async values => {
		Object.assign(t.context.store, values);
	});

	browser.storage.local.remove.callsFake(async key => {
		delete t.context.store[key];
	});

	browser.notifications.create.resolves('id');
	browser.notifications.getPermissionLevel.returns('granted');
	browser.notifications.getAll.callsFake(async () => Object.fromEntries(
		browser.notifications.create.args.map(([id]) => [id, {}])
	));
	browser.notifications.clear.resolves(true);
	browser.permissions.contains.resolves(true);
	browser.runtime.getURL.returns('icon-notif.png');
	browser.tabs.query.resolves([]);
	browser.tabs.create.resolves(true);

	fakeApiResponses({
		'/pulls/42': pullRequestResponse
	});
});

test.serial('getBuildKey builds a stable identifier', t => {
	t.is(builds.getBuildKey(pullRequest), 'user/repo#42');
});

test.serial('summarizeChecks reports pending while a check is running', t => {
	const summary = builds.summarizeChecks({
		statuses: [{context: 'ci/lint', state: 'success'}],
		checkRuns: [{name: 'test', status: 'in_progress'}]
	});

	t.is(summary.state, 'pending');
	t.is(summary.pending, 1);
	t.is(summary.passed, 1);
	t.is(summary.total, 2);
});

test.serial('summarizeChecks reports success when every check passed', t => {
	const summary = builds.summarizeChecks({
		statuses: [{context: 'ci/lint', state: 'success'}],
		checkRuns: [
			{name: 'test', status: 'completed', conclusion: 'success'},
			{name: 'optional', status: 'completed', conclusion: 'skipped'}
		]
	});

	t.is(summary.state, 'success');
	t.is(summary.passed, 3);
	t.is(summary.failed, 0);
	t.deepEqual(summary.failedNames, []);
});

test.serial('summarizeChecks reports failures with their names', t => {
	const summary = builds.summarizeChecks({
		statuses: [{context: 'ci/lint', state: 'error'}],
		checkRuns: [
			{name: 'test', status: 'completed', conclusion: 'failure'},
			{name: 'build', status: 'completed', conclusion: 'success'}
		]
	});

	t.is(summary.state, 'failure');
	t.is(summary.failed, 2);
	t.deepEqual(summary.failedNames, ['ci/lint', 'test']);
});

test.serial('summarizeChecks lists every check for the log', t => {
	const summary = builds.summarizeChecks({
		statuses: [{context: 'ci/lint', state: 'success', target_url: 'https://ci.example.com/1'}], // eslint-disable-line camelcase
		checkRuns: [{name: 'test', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/checks/2'}] // eslint-disable-line camelcase
	});

	t.deepEqual(summary.checks, [
		{name: 'ci/lint', state: 'success', url: 'https://ci.example.com/1'},
		{name: 'test', state: 'failure', url: 'https://github.com/checks/2'}
	]);
});

test.serial('summarizeChecks stays pending when there are no checks yet', t => {
	const summary = builds.summarizeChecks({statuses: [], checkRuns: []});

	t.is(summary.state, 'pending');
	t.is(summary.total, 0);
});

test.serial('watching a pull request stores it with the head commit', async t => {
	await builds.watchBuild(pullRequest);

	t.true(await builds.isWatchingBuild(pullRequest));
	t.is(await builds.getWatchedBuildCount(), 1);

	const watched = await builds.getWatchedBuilds();
	t.is(watched['user/repo#42'].sha, 'abc123');
	t.is(watched['user/repo#42'].title, 'Add a feature');
});

test.serial('toggleBuildWatch adds and removes the pull request', async t => {
	t.deepEqual(await builds.toggleBuildWatch(pullRequest), {watching: true});
	t.true(await builds.isWatchingBuild(pullRequest));

	t.deepEqual(await builds.toggleBuildWatch(pullRequest), {watching: false});
	t.false(await builds.isWatchingBuild(pullRequest));
});

test.serial('checkWatchedBuilds keeps watching while checks are running', async t => {
	await builds.watchBuild(pullRequest);

	fakeApiResponses({
		'/pulls/42': pullRequestResponse,
		'/status': {statuses: []},
		'/check-runs': {check_runs: [{name: 'test', status: 'in_progress'}]} // eslint-disable-line camelcase
	});

	await builds.checkWatchedBuilds();

	t.true(await builds.isWatchingBuild(pullRequest));
	t.is(browser.notifications.create.callCount, 0);
});

test.serial('checkWatchedBuilds notifies and stops watching when checks finish', async t => {
	await builds.watchBuild(pullRequest);

	fakeApiResponses({
		'/pulls/42': pullRequestResponse,
		'/status': {statuses: [{context: 'ci/lint', state: 'success'}]},
		'/check-runs': {check_runs: [{name: 'test', status: 'completed', conclusion: 'failure'}]} // eslint-disable-line camelcase
	});

	await builds.checkWatchedBuilds();

	t.false(await builds.isWatchingBuild(pullRequest));
	t.is(browser.notifications.create.callCount, 1);

	const [notificationId, notification] = browser.notifications.create.firstCall.args;
	t.true(notificationId.startsWith(builds.buildNotificationPrefix));
	t.is(notification.title, 'Checks failed');
	t.true(notification.contextMessage.includes('test'));
});

test.serial('checkWatchedBuilds notifies once a closed pull request has no pending checks', async t => {
	await builds.watchBuild(pullRequest);

	fakeApiResponses({
		'/pulls/42': {...pullRequestResponse, state: 'closed'},
		'/status': {statuses: []},
		'/check-runs': {check_runs: []} // eslint-disable-line camelcase
	});

	await builds.checkWatchedBuilds();

	t.false(await builds.isWatchingBuild(pullRequest));
	t.is(browser.notifications.create.callCount, 1);
});

test.serial('checkWatchedBuilds keeps the build when the request fails', async t => {
	await builds.watchBuild(pullRequest);

	global.fetch = sinon.stub().rejects(new Error('network error'));

	await builds.checkWatchedBuilds();

	t.true(await builds.isWatchingBuild(pullRequest));
});

test.serial('clicking a build notification opens the checks page', async t => {
	const notificationId = `${builds.buildNotificationPrefix}user/repo#42`;
	t.context.store[notificationId] = {url: 'https://github.com/user/repo/pull/42/checks'};

	await builds.openBuildNotification(notificationId);

	t.is(browser.notifications.clear.firstCall.args[0], notificationId);
	t.is(browser.tabs.create.firstCall.args[0].url, 'https://github.com/user/repo/pull/42/checks');
	t.false(notificationId in t.context.store);
});

test.serial('the test notification is shown even when the option is off', async t => {
	browser.storage.sync.get.callsFake((key, cb) => {
		cb({
			options: {
				token: 'a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0',
				rootUrl: 'https://github.com/',
				notifyBuildResults: false,
				playNotifSound: false
			}
		});
	});

	const result = await builds.showTestBuildNotification();

	t.true(result.shown);
	t.is(browser.notifications.create.callCount, 1);

	const [notificationId, notification] = browser.notifications.create.firstCall.args;
	t.true(notificationId.startsWith(builds.buildNotificationPrefix));
	t.is(notification.title, 'Checks failed');

	// The test notification points at a real page, not at the checks of a made-up pull request
	t.is(t.context.store[notificationId].url, 'https://github.com/notifications');
});

test.serial('a check result is not shown when notifications are switched off', async t => {
	browser.storage.sync.get.callsFake((key, cb) => {
		cb({
			options: {
				token: 'a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0',
				rootUrl: 'https://github.com/',
				notifyBuildResults: false
			}
		});
	});

	const result = await builds.showBuildNotification({owner: 'user', repository: 'repo', number: 42}, {state: 'success', total: 1, passed: 1, failed: 0, failedNames: []});

	t.false(result.shown);
	t.is(result.reason, 'disabled');
	t.is(browser.notifications.create.callCount, 0);
});

test.serial('nothing is shown when the browser blocks notifications from extensions', async t => {
	browser.notifications.getPermissionLevel.returns('denied');

	const result = await builds.showTestBuildNotification();

	t.false(result.shown);
	t.is(result.reason, 'blocked');
	t.is(browser.notifications.create.callCount, 0);
});

test.serial('a failing notification sound does not swallow the notification', async t => {
	browser.storage.sync.get.callsFake((key, cb) => {
		cb({
			options: {
				token: 'a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0',
				rootUrl: 'https://github.com/',
				notifyBuildResults: true,
				playNotifSound: true
			}
		});
	});

	browser.runtime.sendMessage.rejects(new Error('Could not establish connection'));

	const result = await builds.showTestBuildNotification();

	t.true(result.shown);
	t.is(browser.notifications.create.callCount, 1);
});

test.serial('a finished build leaves its result for the toolbar icon', async t => {
	await builds.watchBuild(pullRequest);

	fakeApiResponses({
		'/pulls/42': pullRequestResponse,
		'/status': {statuses: [{context: 'ci/lint', state: 'success'}]},
		'/check-runs': {check_runs: [{name: 'test', status: 'completed', conclusion: 'failure'}]} // eslint-disable-line camelcase
	});

	await builds.checkWatchedBuilds();

	const result = await builds.getPendingBuildResult();
	t.is(result.state, 'failure');
	t.is(result.url, 'https://github.com/user/repo/pull/42/checks');
	t.true(result.title.includes('user/repo#42'));
	t.true(result.title.includes('test'));

	await builds.clearPendingBuildResult();
	t.is(await builds.getPendingBuildResult(), undefined);
});

test.serial('the test notification reports whether the browser accepted it', async t => {
	const result = await builds.showTestBuildNotification();

	t.true(result.shown);
	t.true(result.accepted);
});

import test from 'ava';
import {getPullRequestNumber} from '../source/lib/pr-header.js';

test('getPullRequestNumber reads the number of pull request pages only', t => {
	t.is(getPullRequestNumber('/user/repo/pull/42'), 42);
	t.is(getPullRequestNumber('/user/repo/pull/42/files'), 42);
	t.is(getPullRequestNumber('/user/repo/pull/42/checks'), 42);
	t.is(getPullRequestNumber('/user/repo/issues/42'), undefined);
	t.is(getPullRequestNumber('/user/repo'), undefined);
});

// A banner drawn on the page itself, for the case where the operating system
// hides desktop notifications from the browser
export const toastClass = 'notifier-for-github-result';

const colors = {
	success: 'var(--fgColor-success, #1a7f37)',
	failure: 'var(--fgColor-danger, #cf222e)'
};

function createButton(label, primary) {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = label;
	Object.assign(button.style, {
		padding: '3px 12px',
		font: 'inherit',
		fontWeight: '500',
		color: primary ? 'var(--fgColor-onEmphasis, #ffffff)' : 'var(--fgColor-default, #1f2328)',
		background: primary ? 'var(--bgColor-accent-emphasis, #0969da)' : 'var(--bgColor-default, #ffffff)',
		border: '1px solid var(--borderColor-default, #d1d9e0)',
		borderRadius: '6px',
		cursor: 'pointer'
	});
	return button;
}

export function renderResultToast(result, {onOpen, onDismiss}) {
	removeResultToast();

	const toast = document.createElement('div');
	toast.className = toastClass;
	toast.setAttribute('role', 'status');
	Object.assign(toast.style, {
		position: 'fixed',
		right: '16px',
		bottom: '16px',
		zIndex: '2147483647',
		maxWidth: 'min(380px, calc(100vw - 32px))',
		padding: '12px 16px',
		font: '13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		color: 'var(--fgColor-default, #1f2328)',
		background: 'var(--bgColor-default, #ffffff)',
		border: '1px solid var(--borderColor-default, #d1d9e0)',
		borderLeft: `4px solid ${colors[result.state] || colors.failure}`,
		borderRadius: '8px',
		boxShadow: '0 8px 24px rgba(31, 35, 40, 0.2)'
	});

	const heading = document.createElement('strong');
	heading.textContent = result.title;
	heading.style.display = 'block';
	heading.style.marginBottom = '8px';

	const actions = document.createElement('div');
	actions.style.display = 'flex';
	actions.style.gap = '8px';

	const open = createButton('Open checks', true);
	open.addEventListener('click', onOpen);

	const dismiss = createButton('Dismiss', false);
	dismiss.addEventListener('click', onDismiss);

	actions.append(open, dismiss);
	toast.append(heading, actions);
	document.body.append(toast);

	return toast;
}

export function removeResultToast() {
	const existing = document.querySelector(`.${toastClass}`);
	if (existing) {
		existing.remove();
	}
}

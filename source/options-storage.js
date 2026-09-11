import OptionsSync from 'webext-options-sync';

const optionsStorage = new OptionsSync({
	defaults: {
		token: '',
		rootUrl: 'https://github.com/',
		playNotifSound: false,
		showDesktopNotif: false,
		onlyParticipating: false,
		reuseTabs: false,
		updateCountOnNavigation: false,
		filterNotifications: false,
		notifyBuildResults: false,
		buildNotificationStyle: 'desktop',
		buildPollInterval: 60
	},
	migrations: [
		OptionsSync.migrations.removeUnused
	]
});

export default optionsStorage;

// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require network';

const callTestMail = rpc.declare({
	object: 'luci.notifip',
	method: 'test_mail',
	expect: { '': {} }
});

const callCheckNow = rpc.declare({
	object: 'luci.notifip',
	method: 'check_now',
	expect: { '': {} }
});

function emailValidator(_section, value) {
	if (!value) return true;
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? true : _('Invalid email address');
}

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('notifip'),
			network.getNetworks()
		]);
	},

	render: function (data) {
		const networks = data[1] || [];
		const m = new form.Map('notifip',
			_('NotifIP — Settings'),
			_('Sends an email when the WAN IP changes. ' +
				'Make sure to Save & Apply before clicking "Send test mail".'));

		let s = m.section(form.NamedSection, 'general', 'notifip', _('General'));
		s.anonymous = true;

		let o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'interval', _('Check interval (minutes)'),
			_('Cron period between checks. Detection is also triggered on every WAN ifup.'));
		o.datatype = 'and(uinteger,min(1),max(1440))';
		o.default = '5';
		o.rmempty = false;

		o = s.option(form.ListValue, 'mode', _('IP source to monitor'));
		o.value('public', _('Public IP (external HTTP services)'));
		o.value('iface', _('Local WAN interface IP(s)'));
		o.default = 'public';

		o = s.option(form.MultiValue, 'iface', _('Interfaces to monitor'),
			_('Select one or more network interfaces.'));
		o.depends('mode', 'iface');
		networks.forEach(function (n) {
			const name = n.getName();
			if (name && name !== 'loopback') {
				o.value(name, name);
			}
		});

		o = s.option(form.Flag, 'boot_mail', _('Boot mail'),
			_('Send a mail on the first check after each reboot.'));
		o.default = '1';
		o.rmempty = false;

		// --- SMTP ---
		s = m.section(form.NamedSection, 'smtp', 'smtp', _('SMTP'),
			_('Mail account used to send the notification. ' +
				'The password is stored in /etc/config/notifip (readable by root only).'));
		s.anonymous = true;

		o = s.option(form.Value, 'host', _('SMTP server'));
		o.placeholder = 'smtp.example.com';

		o = s.option(form.Value, 'port', _('Port'));
		o.datatype = 'port';
		o.default = '587';

		o = s.option(form.ListValue, 'security', _('Security'));
		o.value('none', _('None'));
		o.value('starttls', 'STARTTLS');
		o.value('smtps', 'SMTPS (SSL/TLS)');
		o.default = 'starttls';

		o = s.option(form.Value, 'user', _('Username'));
		o.placeholder = 'user@example.com';

		o = s.option(form.Value, 'password', _('Password'));
		o.password = true;

		o = s.option(form.Value, 'from', _('From'));
		o.placeholder = 'router@example.com';
		o.validate = emailValidator;

		o = s.option(form.Value, 'to', _('To'));
		o.placeholder = 'you@example.com';
		o.validate = emailValidator;

		o = s.option(form.Button, '_checknow', _('Check now'),
			_('Run an immediate IP check using the saved configuration. Useful to populate the History without waiting for the next cron tick.'));
		o.inputtitle = _('Check now');
		o.onclick = function () {
			ui.showModal(_('Checking…'), [
				E('p', { 'class': 'spinning' }, _('Running notifip check-now…'))
			]);
			return callCheckNow().then(function (res) {
				ui.hideModal();
				const ok = (res && res.code === 0);
				ui.showModal(ok ? _('Done') : _('Check failed'), [
					E('p', {}, (res && res.result) || _('(no output)')),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
					])
				]);
			}).catch(function (err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('RPC error: ') + err), 'danger');
			});
		};

		o = s.option(form.Button, '_test', _('Send test mail'),
			_('Immediately sends a test mail using the SAVED configuration. Save & Apply first.'));
		o.inputtitle = _('Send test mail');
		o.onclick = function () {
			ui.showModal(_('Sending…'), [
				E('p', { 'class': 'spinning' }, _('msmtp is running…'))
			]);
			return callTestMail().then(function (res) {
				ui.hideModal();
				const ok = (res && res.code === 0);
				ui.showModal(ok ? _('Success') : _('Failure'), [
					E('p', {}, (res && res.result) || _('(no output)')),
					(res && res.log)
						? E('pre', {
							'style': 'max-height:240px;overflow:auto;font-size:11px'
						}, res.log)
						: '',
					E('div', { 'class': 'right' }, [
						E('button', {
							'class': 'btn cbi-button',
							'click': ui.hideModal
						}, _('Close'))
					])
				]);
			}).catch(function (err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('RPC error: ') + err), 'danger');
			});
		};

		return m.render();
	}
});

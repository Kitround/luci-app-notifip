// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require dom';
'require poll';
'require network';

const callStatus = rpc.declare({
	object: 'luci.notifip',
	method: 'status',
	expect: { '': {} }
});

const callLog = rpc.declare({
	object: 'luci.notifip',
	method: 'log',
	expect: { 'entries': [] }
});

const callClear = rpc.declare({
	object: 'luci.notifip',
	method: 'clear_log',
	expect: { '': {} }
});

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

// A tab holding arbitrary content rather than UCI options. form.Map only wires
// data-tab attributes for real sections, so the pane sets its own.
const PaneSection = form.NamedSection.extend({
	__name__: 'PaneSection',

	__init__: function (map, section_id, tab, title, builder) {
		this.super('__init__', [ map, section_id, 'notifip', title ]);
		this.tabName = tab;
		this.builder = builder;
	},

	render: function () {
		return E('div', {
			'class': 'cbi-section',
			'data-tab': this.tabName,
			'data-tab-title': this.title
		}, this.builder());
	}
});

// Every child below is passed as an array on purpose. LuCI's dom.append gives an
// array child text nodes but assigns a bare string to innerHTML, and these values
// come out of the rpc reply — the state file and the configured source URLs.
function renderStatus(st) {
	if (!st || !st.state) {
		return E('p', {}, [ _('No data.') ]);
	}
	const rows = (st.state || []).map(function (row) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ row.key ]),
			E('td', { 'class': 'td' }, [ row.ip ]),
			E('td', { 'class': 'td' }, [ row.since ])
		]);
	});
	return E('div', {}, [
		E('p', {}, [
			E('strong', {}, [ _('Enabled: ') ]), String(st.enabled) + ' — ',
			E('strong', {}, [ _('Mode: ') ]), st.mode + ' — ',
			E('strong', {}, [ _('Interval: ') ]), st.interval + ' min'
		]),
		E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('Source') ]),
				E('th', { 'class': 'th' }, [ _('Current IP') ]),
				E('th', { 'class': 'th' }, [ _('Since') ])
			])
		].concat(rows.length ? rows : [E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'colspan': 3 }, [ _('No IP observed yet.') ])
		])]))
	]);
}

function renderLog(entries) {
	entries = entries || [];
	if (!entries.length) {
		return E('p', {}, [ _('No change recorded.') ]);
	}
	const rows = entries.slice().reverse().map(function (e) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ e.ts ]),
			E('td', { 'class': 'td' }, [ e.iface ]),
			E('td', { 'class': 'td' }, [ e.old ]),
			E('td', { 'class': 'td' }, [ e.new ]),
			E('td', { 'class': 'td' }, [ e.notified ]),
			E('td', { 'class': 'td', 'style': 'font-size:11px;color:#888' }, [ e.source ])
		]);
	});
	return E('table', { 'class': 'table cbi-section-table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, [ _('Date') ]),
			E('th', { 'class': 'th' }, [ _('Interface') ]),
			E('th', { 'class': 'th' }, [ _('Old IP') ]),
			E('th', { 'class': 'th' }, [ _('New IP') ]),
			E('th', { 'class': 'th' }, [ _('Notified') ]),
			E('th', { 'class': 'th' }, [ _('Source') ])
		])
	].concat(rows));
}

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('notifip'),
			network.getNetworks(),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(callLog(), [])
		]);
	},

	render: function (data) {
		const networks = data[1] || [];
		const m = new form.Map('notifip', _('NotifIP'),
			_('Sends an email when the WAN IP changes. ' +
				'The "Check now" and "Send test mail" buttons use the SAVED configuration, ' +
				'so use Save &amp; Apply first.'));
		m.tabbed = true;

		// --- General (section type "notifip", so that is the tab key) ---
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

		o = s.option(form.Button, '_test', _('Send test mail'),
			_('Immediately sends a test mail using the SAVED configuration. Save &amp; Apply first.'));
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

		// --- Sources ---
		s = m.section(form.NamedSection, 'sources', 'sources', _('Sources'),
			_('Ordered list of URLs queried to fetch the public IP. ' +
				'NotifIP tries each URL in order, keeps the first that responds, ' +
				'and confirms any change with the next URL before sending a mail. ' +
				'This list is only used when the mode is "Public IP".'));
		s.anonymous = true;

		o = s.option(form.DynamicList, 'url', _('URLs'));
		o.placeholder = 'https://api.ipify.org';
		o.rmempty = false;
		o.validate = function (_section, value) {
			if (!value) return true;
			return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value)
				? true
				: _('Must be an http(s) URL');
		};

		// --- History: not a UCI form, so it goes in through a PaneSection ---
		const statusBox = E('div', { 'id': 'notifip-status' }, renderStatus(data[2]));
		const logBox    = E('div', { 'id': 'notifip-log' },    renderLog(data[3]));

		function refresh() {
			return Promise.all([
				L.resolveDefault(callStatus(), {}),
				L.resolveDefault(callLog(), [])
			]).then(function (r) {
				dom.content(statusBox, renderStatus(r[0]));
				dom.content(logBox,    renderLog(r[1]));
			});
		}

		m.section(PaneSection, 'general', 'history', _('History'), function () {
			return [
				E('div', { 'class': 'cbi-section-descr' },
					_('Current state and recorded changes, refreshed every 30 s. ' +
						'The "Clear history" button below belongs to this tab only; ' +
						'the Save &amp; Apply bar at the bottom of the page belongs to the settings form ' +
						'and does not touch the history.')),
				E('h3', {}, _('Current state')),
				statusBox,
				E('h3', {}, _('Changes')),
				logBox,
				E('div', { 'style': 'margin:.5em 0' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': ui.createHandlerFn(this, refresh)
					}, _('Refresh')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'click': ui.createHandlerFn(this, function () {
							if (!confirm(_('Clear history?'))) return;
							return callClear().then(refresh);
						})
					}, _('Clear history'))
				])
			];
		});

		poll.add(refresh, 30);

		return m.render();
	}
});

// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require rpc';
'require dom';
'require poll';

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

function renderStatus(st) {
	if (!st || !st.state) {
		return E('p', {}, _('No data.'));
	}
	const rows = (st.state || []).map(function (row) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, row.key),
			E('td', { 'class': 'td' }, row.ip),
			E('td', { 'class': 'td' }, row.since)
		]);
	});
	return E('div', {}, [
		E('p', {}, [
			E('strong', {}, _('Enabled: ')), String(st.enabled) + ' — ',
			E('strong', {}, _('Mode: ')), st.mode + ' — ',
			E('strong', {}, _('Interval: ')), st.interval + ' min'
		]),
		E('table', { 'class': 'table cbi-section-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Source')),
				E('th', { 'class': 'th' }, _('Current IP')),
				E('th', { 'class': 'th' }, _('Since'))
			])
		].concat(rows.length ? rows : [E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'colspan': 3 }, _('No IP observed yet.'))
		])]))
	]);
}

function renderLog(entries) {
	entries = entries || [];
	if (!entries.length) {
		return E('p', {}, _('No change recorded.'));
	}
	const rows = entries.slice().reverse().map(function (e) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, e.ts),
			E('td', { 'class': 'td' }, e.iface),
			E('td', { 'class': 'td' }, e.old),
			E('td', { 'class': 'td' }, e.new),
			E('td', { 'class': 'td' }, e.notified),
			E('td', { 'class': 'td', 'style': 'font-size:11px;color:#888' }, e.source)
		]);
	});
	return E('table', { 'class': 'table cbi-section-table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Date')),
			E('th', { 'class': 'th' }, _('Interface')),
			E('th', { 'class': 'th' }, _('Old IP')),
			E('th', { 'class': 'th' }, _('New IP')),
			E('th', { 'class': 'th' }, _('Notified')),
			E('th', { 'class': 'th' }, _('Source'))
		])
	].concat(rows));
}

return view.extend({
	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null,

	load: function () {
		return Promise.all([callStatus(), callLog()]);
	},

	render: function (data) {
		const statusBox = E('div', {}, renderStatus(data[0]));
		const logBox    = E('div', {}, renderLog(data[1]));

		function refresh() {
			return Promise.all([callStatus(), callLog()]).then(function (r) {
				dom.content(statusBox, renderStatus(r[0]));
				dom.content(logBox,    renderLog(r[1]));
			});
		}

		poll.add(refresh, 30);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('NotifIP — History')),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Current state')),
				statusBox
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Changes')),
				logBox,
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': function () { return refresh(); }
					}, _('Refresh')),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-remove',
						'click': function () {
							if (!confirm(_('Clear history?'))) return;
							return callClear().then(refresh);
						}
					}, _('Clear history'))
				])
			])
		]);
	}
});

// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require form';
'require uci';

return view.extend({
	load: function () {
		return uci.load('notifip');
	},

	render: function () {
		const m = new form.Map('notifip',
			_('NotifIP — Public IP check sources'),
			_('Ordered list of URLs queried to fetch the public IP. ' +
				'NotifIP tries each URL in order, keeps the first that responds, ' +
				'and confirms any change with the next URL before sending a mail. ' +
				'This list is only used when the mode is "Public IP".'));

		const s = m.section(form.NamedSection, 'sources', 'sources');
		s.anonymous = true;

		const o = s.option(form.DynamicList, 'url', _('URLs'));
		o.placeholder = 'https://api.ipify.org';
		o.rmempty = false;
		o.validate = function (_section, value) {
			if (!value) return true;
			return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value)
				? true
				: _('Must be an http(s) URL');
		};

		return m.render();
	}
});

#!/usr/bin/env node
'use strict';

// Exercises the LuCI view without a browser.
//
// main.js is not a module: it ends in `return view.extend(...)` because LuCI wraps
// each view in a function and calls it with the objects its `require` lines name.
// This does the same, with stubs that record what the view builds, so the resulting
// structure and behaviour can be asserted on.
//
// It exists because neither the package build nor tests/state.sh can see any of
// this. The tabs reloading the whole page on every switch — three menu entries
// where there should have been one — shipped in every release up to 1.2.0 and no
// automated check could have noticed.

const fs = require('fs');
const path = require('path');

const PKG = 'luci-app-notifip';
const VIEW = path.join(__dirname, PKG, 'htdocs/luci-static/resources/view/notifip/main.js');
const MENU = path.join(__dirname, PKG, 'root/usr/share/luci/menu.d/luci-app-notifip.json');
const ACL = path.join(__dirname, PKG, 'root/usr/share/rpcd/acl.d/luci-app-notifip.json');
const WORKER = path.join(__dirname, PKG, 'root/usr/bin/notifip');
const RPCD = path.join(__dirname, PKG, 'root/usr/libexec/rpcd/luci.notifip');
const CONFIG = path.join(__dirname, PKG, 'root/etc/config/notifip');

let passed = 0, failed = 0;

function ok(cond, name) {
	if (cond) { passed++; console.log('ok: ' + name); }
	else { failed++; console.error('FAIL: ' + name); }
}

function eq(actual, expected, name) {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a === e) { passed++; console.log('ok: ' + name); }
	else { failed++; console.error(`FAIL: ${name}\n      expected ${e}\n      got      ${a}`); }
}

// --- LuCI emulation ---------------------------------------------------------

function makeClass(base, props) {
	function C() { if (this.__init__) this.__init__.apply(this, arguments); }
	C.prototype = Object.create(base ? base.prototype : Object.prototype);
	Object.assign(C.prototype, props || {});
	C.prototype.super = function (name, args) {
		const b = base && base.prototype;
		return (b && typeof b[name] === 'function') ? b[name].apply(this, args || []) : undefined;
	};
	C.extend = function (p) { return makeClass(C, p); };
	return C;
}

function named(cls, n) { cls.__name = n; return cls; }

function makeEnv(opts) {
	opts = opts || {};

	const E = (tag, attr, children) => ({
		tag,
		attr: attr || {},
		children: Array.isArray(children) ? children : (children == null ? [] : [ children ]),
		// LuCI's dom.append turns an array child into text nodes but a bare string
		// into innerHTML. Recorded so the tests can insist on the safe form.
		rawHtml: (typeof children === 'string')
	});

	const notifications = [], polls = [], rpcCalls = [], modals = [], optionsSeen = [];
	let map = null;

	const ui = {
		showModal(title, children) { modals.push({ title, children, open: true }); },
		hideModal() { modals.forEach(m => { m.open = false; }); },
		addNotification(title, children, ...classes) {
			notifications.push({ title, children, classes });
		},
		createHandlerFn: (self, fn) => fn
	};

	const L = {
		resolveDefault: (p, d) => Promise.resolve(p).catch(() => d),
		toArray: v => (v == null ? [] : (Array.isArray(v) ? v : [ v ]))
	};

	const dom = {
		content(node, child) {
			node.children = Array.isArray(child) ? child : [ child ];
			return node;
		}
	};

	// LuCI writes data-tab from the section *type*, and the title from the section
	// title. Mirrored exactly, because getting that wrong is what collapses two
	// tabs into one.
	const SectionBase = makeClass(null, {
		__init__(m, ...rest) {
			this.map = m;
			this.args = rest;
			this.section_id = rest[0];
			this.sectiontype = rest[1];
			this.title = rest[2];
			this.description = rest[3];
			this.children = [];
		},
		option(cls, name, title, desc) {
			const o = {
				__cls: (cls && cls.__name) || 'Option',
				option: name, title, description: desc,
				deps: [], section: this, map: this.map,
				depends(k, v) { this.deps.push([ k, v ]); return this; },
				value(k, v) {
					(this.keylist = this.keylist || []).push(k);
					(this.vallist = this.vallist || []).push(v);
					return this;
				}
			};
			this.children.push(o);
			optionsSeen.push(o);
			return o;
		},
		render() {
			return E('div', {
				'class': 'cbi-section',
				'data-tab': (this.map.tabbed ? this.sectiontype : null),
				'data-tab-title': (this.map.tabbed ? (this.title || this.sectiontype) : null)
			}, []);
		}
	});

	const form = {
		Map: makeClass(null, {
			__init__(config, title, desc) {
				this.config = config; this.title = title; this.description = desc;
				this.sections = [];
				map = this;
			},
			section(cls, ...args) {
				const s = new cls(this, ...args);
				s.__cls = cls.__name || cls.prototype.__name__ || 'Section';
				this.sections.push(s);
				return s;
			},
			render() {
				return E('div', { 'class': 'cbi-map' },
					this.tabbed
						? [ E('div', { 'class': 'cbi-map-tabbed' }, this.sections.map(s => s.render())) ]
						: this.sections.map(s => s.render()));
			}
		}),
		NamedSection: named(SectionBase.extend({}), 'NamedSection'),
		TypedSection: named(SectionBase.extend({}), 'TypedSection'),
		Value: named(function Value() {}, 'Value'),
		Flag: named(function Flag() {}, 'Flag'),
		ListValue: named(function ListValue() {}, 'ListValue'),
		MultiValue: named(function MultiValue() {}, 'MultiValue'),
		DynamicList: named(function DynamicList() {}, 'DynamicList'),
		Button: named(function Button() {}, 'Button')
	};

	const rpc = {
		declare(spec) {
			rpcCalls.push(spec);
			const fn = (...args) => Promise.resolve(
				opts.rpcReply ? opts.rpcReply(spec, args) : { code: 0, result: 'OK' });
			fn.__spec = spec;
			return fn;
		}
	};

	const uci = { load: () => Promise.resolve() };
	const network = {
		getNetworks: () => Promise.resolve(
			(opts.networks || [ 'lan', 'wan', 'wan6', 'loopback' ])
				.map(n => ({ getName: () => n })))
	};
	const poll = { add: (fn, s) => polls.push([ fn, s ]) };

	let viewObj = null;
	const view = { extend(o) { viewObj = o; return o; } };

	return { E, L, ui, dom, form, rpc, uci, network, poll, view,
	         notifications, polls, rpcCalls, modals, optionsSeen,
	         getMap: () => map, getView: () => viewObj };
}

function loadView(env) {
	global.L = env.L;
	global.E = env.E;
	global._ = s => s;
	global.confirm = () => (env.confirmAnswer !== false);

	const src = fs.readFileSync(VIEW, 'utf8');
	const fn = new Function('L', 'E', '_', 'view', 'form', 'rpc', 'poll', 'ui', 'uci',
		'network', 'dom', src);
	return fn(env.L, env.E, s => s, env.view, env.form, env.rpc, env.poll, env.ui,
		env.uci, env.network, env.dom);
}

function text(node) {
	if (node == null) return '';
	if (typeof node === 'string') return node;
	if (Array.isArray(node)) return node.map(text).join(' ');
	if (node.children) return node.children.map(text).join(' ');
	return '';
}

function findAll(node, pred, out) {
	out = out || [];
	if (node && typeof node === 'object') {
		if (Array.isArray(node)) node.forEach(n => findAll(n, pred, out));
		else {
			if (pred(node)) out.push(node);
			(node.children || []).forEach(n => findAll(n, pred, out));
		}
	}
	return out;
}

const STATUS = {
	enabled: 1, mode: 'public', interval: 5,
	state: [ { key: 'public', ip: '203.0.113.7', since: '2026-08-01T10:00:00' } ]
};

const LOG = [
	{ ts: '2026-08-01 10:00:00', source: 'https://api.ipify.org', iface: 'public',
	  old: '203.0.113.1', new: '203.0.113.7', notified: 'yes' }
];

function page(opts) {
	opts = opts || {};
	const env = makeEnv(opts);
	const v = loadView(env);
	env.view_ = v;
	env.tree = v.render([ null, (opts.networks || [ 'lan', 'wan', 'wan6', 'loopback' ])
		.map(n => ({ getName: () => n })),
		opts.status !== undefined ? opts.status : STATUS,
		opts.log !== undefined ? opts.log : LOG ]);
	env.map = env.getMap();
	env.tabs = findAll(env.tree, n => n.attr && n.attr['data-tab']);
	env.sectionById = Object.fromEntries(env.map.sections
		.filter(s => s.children && s.children.length)
		.map(s => [ s.section_id, s ]));
	env.byId = id => findAll(env.tree, n => n.attr && n.attr.id === id)[0] || null;
	return env;
}

// --- the reason this file exists --------------------------------------------

console.log('# one page, not three');
{
	const menu = JSON.parse(fs.readFileSync(MENU, 'utf8'));
	const entries = Object.keys(menu);
	eq(entries, [ 'admin/services/notifip' ],
		'a single menu entry, so switching tabs is not navigation');
	eq(menu[entries[0]].action, { type: 'view', path: 'notifip/main' },
		'and it points at the one combined view');

	const dir = path.dirname(VIEW);
	eq(fs.readdirSync(dir).sort(), [ 'main.js' ],
		'no leftover per-tab view files');
}

console.log('# the tabs are the form\'s own');
{
	const env = page();
	ok(typeof env.view_.load === 'function' && typeof env.view_.render === 'function',
		'the view exports load() and render()');
	ok(env.map.tabbed === true,
		'the Map is tabbed, otherwise the sections stack into one long page');
	eq(findAll(env.tree, n => n.attr && n.attr.class === 'cbi-map-tabbed').length, 1,
		'the sections sit in the container LuCI turns into a tab group');

	const keys = env.tabs.map(n => n.attr['data-tab']);
	// LuCI keys tabs by section *type*. Two sections sharing one type silently
	// collapse into a single tab.
	eq(keys, [ 'notifip', 'smtp', 'sources', 'history' ],
		'four tabs, in order, keyed by section type');
	eq(new Set(keys).size, keys.length, 'every tab key is distinct');
	eq(env.tabs.map(n => n.attr['data-tab-title']),
		[ 'General', 'SMTP', 'Sources', 'History' ], 'each tab is titled');
	ok(env.tabs.every(n => n.attr['data-tab-title']),
		'no tab falls back to showing its section type as its title');
}

// --- the form matches what the worker actually reads -------------------------

console.log('# every setting the worker reads is on the page');
{
	const worker = fs.readFileSync(WORKER, 'utf8');
	const wanted = {};
	for (const m of worker.matchAll(/^\s*config_get\s+\w+\s+(\w+)\s+(\w+)/mg))
		(wanted[m[1]] = wanted[m[1]] || []).push(m[2]);
	for (const m of worker.matchAll(/^\s*config_list_foreach\s+(\w+)\s+(\w+)/mg))
		(wanted[m[1]] = wanted[m[1]] || []).push(m[2]);

	ok(Object.keys(wanted).length === 3, 'the worker reads three uci sections');

	const env = page();
	for (const [ section, options ] of Object.entries(wanted)) {
		const s = env.sectionById[section];
		ok(s != null, `the form builds the "${section}" section`);
		if (!s) continue;
		// Buttons are named with a leading underscore and are not uci options.
		const shown = s.children.map(o => o.option).filter(n => !n.startsWith('_'));
		eq(shown.slice().sort(), options.slice().sort(),
			`"${section}" exposes exactly what the worker reads`);
	}

	// And nothing shipped in the default config is missing from the form.
	const cfg = fs.readFileSync(CONFIG, 'utf8');
	const inConfig = [ ...cfg.matchAll(/^\s*(?:option|list)\s+(\w+)/mg) ].map(m => m[1]);
	const onPage = env.optionsSeen.map(o => o.option);
	eq(inConfig.filter(n => !onPage.includes(n)), [],
		'every option in the shipped config has a field');
}

console.log('# interface picker');
{
	const env = page();
	const iface = env.optionsSeen.find(o => o.option === 'iface');
	eq(iface.__cls, 'MultiValue', 'interfaces are a multi-select, matching the uci list');
	eq(iface.deps, [ [ 'mode', 'iface' ] ], 'and only shown in interface mode');
	ok(!iface.keylist.includes('loopback'), 'loopback is not offered');
	eq(iface.keylist, [ 'lan', 'wan', 'wan6' ], 'every other network is');
}

// --- the rpc surface ---------------------------------------------------------

console.log('# rpc');
{
	const env = page();
	const methods = env.rpcCalls.map(c => c.method).sort();
	eq(methods, [ 'check_now', 'clear_log', 'log', 'status', 'test_mail' ],
		'the five methods the page needs are declared');
	ok(env.rpcCalls.every(c => c.object === 'luci.notifip'),
		'every call targets one ubus object');

	// A method the ACL does not grant fails for every non-root login, which is
	// exactly the kind of thing that only shows up in production.
	const acl = JSON.parse(fs.readFileSync(ACL, 'utf8'))[PKG];
	const granted = []
		.concat(acl.read.ubus['luci.notifip'] || [])
		.concat(acl.write.ubus['luci.notifip'] || []);
	eq(methods.filter(m => !granted.includes(m)), [],
		'the ACL grants every method the page calls');
	eq(granted.filter(m => !methods.includes(m)), [],
		'and grants nothing the page never calls');
	eq(acl.read.ubus['luci.notifip'].slice().sort(), [ 'log', 'status' ],
		'only the read-only methods are readable');
	ok(acl.read.file === undefined && acl.write.file === undefined,
		'no file permissions are granted, since the page reads none');

	// The rpcd plugin has to actually implement them.
	const rpcd = fs.readFileSync(RPCD, 'utf8');
	eq(methods.filter(m => !rpcd.includes(`json_add_object "${m}"`)), [],
		'the rpcd plugin lists every method');

	eq(env.polls.length, 1, 'the page refreshes itself');
	eq(env.polls[0][1], 30, 'every thirty seconds');
}

// --- the History tab ---------------------------------------------------------

console.log('# History tab');
{
	const env = page();
	const pane = env.tabs.find(n => n.attr['data-tab'] === 'history');
	const t = text(pane);
	ok(/203\.0\.113\.7/.test(t), 'the current IP is shown');
	ok(/203\.0\.113\.1/.test(t), 'and the previous one in the change table');
	ok(/api\.ipify\.org/.test(t), 'along with the source that reported it');
	const buttons = findAll(pane, n => n.tag === 'button').map(text);
	eq(buttons, [ 'Refresh', 'Clear history' ], 'the tab carries its own two buttons');
}

console.log('# History tab: nothing recorded yet');
{
	const env = page({ status: {}, log: [] });
	const t = text(env.tabs.find(n => n.attr['data-tab'] === 'history'));
	ok(/No data\./.test(t), 'an empty status says so');
	ok(/No change recorded\./.test(t), 'and an empty log too');
}

console.log('# History tab: the rpc reply is never injected as markup');
{
	// dom.content gives an array child text nodes and a bare string innerHTML.
	// The log carries a source URL straight from the config and an IP from a
	// third-party HTTP service, so neither may reach the page as markup.
	const env = page({
		status: { enabled: 1, mode: 'public', interval: 5,
		          state: [ { key: 'public', ip: '<img src=x onerror=alert(1)>', since: 'now' } ] },
		log: [ { ts: 'now', source: '<script>alert(1)</script>', iface: 'public',
		         old: '-', new: '<b>x</b>', notified: 'yes' } ]
	});
	eq(findAll(env.byId('notifip-status'), n => n.rawHtml).map(n => n.tag), [],
		'the status table never takes markup from the reply');
	eq(findAll(env.byId('notifip-log'), n => n.rawHtml).map(n => n.tag), [],
		'the change table never takes markup from the reply');
	ok(text(env.byId('notifip-log')).includes('<script>alert(1)</script>'),
		'a hostile source URL is shown as the text it is');
}

// --- the buttons -------------------------------------------------------------

async function handlerTests() {
	console.log('# Check now');
	{
		const env = page();
		const btn = env.optionsSeen.find(o => o.option === '_checknow');
		ok(btn != null && typeof btn.onclick === 'function', 'the button has a handler');
		await btn.onclick();
		ok(env.modals.length >= 2, 'a progress modal, then a result modal');
		ok(env.modals.slice(0, -1).every(m => !m.open),
			'the progress modal is closed rather than stacked under the result');
		ok(/Done/.test(env.modals[env.modals.length - 1].title), 'a zero exit code reads as success');
	}

	console.log('# Send test mail reports a failure as one');
	{
		const env = page({ rpcReply: () => ({ code: 1, result: 'FAIL', log: 'auth failed' }) });
		const btn = env.optionsSeen.find(o => o.option === '_test');
		await btn.onclick();
		const last = env.modals[env.modals.length - 1];
		ok(/Failure/.test(last.title), 'a non-zero exit code reads as failure');
		ok(/auth failed/.test(text(last.children)), 'and the msmtp log is shown');
	}

	console.log('# Send test mail survives a dead ubus');
	{
		const env = page({ rpcReply: () => Promise.reject(new Error('boom')) });
		const btn = env.optionsSeen.find(o => o.option === '_test');
		await btn.onclick();
		ok(env.modals.every(m => !m.open), 'the progress modal is closed, not left spinning');
		eq(env.notifications.map(n => n.classes[0]), [ 'danger' ], 'and the error is surfaced');
	}

	console.log('# the modals never take markup from the reply');
	{
		// Both strings are attacker-influenceable: "unknown mode: <value>" carries a
		// uci value straight back, and the msmtp log carries whatever the SMTP server
		// answered. dom.append gives an array child text nodes but a bare string
		// innerHTML, so every modal child has to be an array.
		const env = page({ rpcReply: () => ({
			code: 1,
			result: 'unknown mode: <img src=x onerror=alert(1)>',
			log: '<script>alert(1)</script>'
		}) });
		for (const name of [ '_checknow', '_test' ])
			await env.optionsSeen.find(o => o.option === name).onclick();
		const bodies = env.modals.map(m => m.children);
		eq(findAll(bodies, n => n.rawHtml).map(n => n.tag), [],
			'no modal node takes a bare string');
		ok(text(bodies).includes('unknown mode: <img src=x onerror=alert(1)>'),
			'the message is shown as the text it is');
		ok(text(bodies).includes('<script>alert(1)</script>'),
			'and so is the msmtp log');
	}

	console.log('# an rpc error is reported as text too');
	{
		const env = page({ rpcReply: () => Promise.reject(new Error('<img src=x onerror=alert(1)>')) });
		await env.optionsSeen.find(o => o.option === '_test').onclick();
		eq(findAll(env.notifications.map(n => n.children), n => n.rawHtml).map(n => n.tag), [],
			'the notification body is text, not markup');
	}

	console.log('# Clear history asks first');
	{
		const env = page();
		env.confirmAnswer = false;
		const pane = env.tabs.find(n => n.attr['data-tab'] === 'history');
		const btn = findAll(pane, n => n.tag === 'button').find(b => text(b) === 'Clear history');
		const r = await btn.attr.click();
		ok(r === undefined, 'declining the confirmation does nothing at all');
	}
}

handlerTests().then(() => {
	console.log('');
	console.log(`${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
}).catch(e => {
	console.error('threw: ' + (e && e.stack || e));
	process.exit(1);
});

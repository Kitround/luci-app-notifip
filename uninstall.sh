#!/usr/bin/env bash
# luci-app-notifip — manual uninstaller
#
# Usage:
#   ./uninstall.sh root@192.168.1.1            # default port 22
#   ./uninstall.sh root@192.168.1.1 -p 2222
#
# Removes every file installed by install.sh. Does NOT remove dependencies
# (msmtp, curl, jsonfilter, ca-bundle) since they may be used by other packages.

set -eo pipefail

if [ $# -lt 1 ]; then
	echo "Usage: $0 <user@host> [-p ssh_port]" >&2
	exit 1
fi

TARGET="$1"; shift
SSH_PORT=""
while [ $# -gt 0 ]; do
	case "$1" in
		-p) SSH_PORT="$2"; shift 2 ;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
done

ssh_cmd() {
	if [ -n "$SSH_PORT" ]; then
		ssh -p "$SSH_PORT" "$@"
	else
		ssh "$@"
	fi
}

echo "==> Stopping and disabling notifip on $TARGET …"
ssh_cmd "$TARGET" '
	/etc/init.d/notifip stop    2>/dev/null || true
	/etc/init.d/notifip disable 2>/dev/null || true
	# Anchored like the init script: a user cron line merely mentioning notifip
	# in a comment is not ours to delete.
	sed -i "/# notifip$/d" /etc/crontabs/root 2>/dev/null || true
	[ -x /etc/init.d/cron ] && /etc/init.d/cron reload 2>/dev/null || true
'

echo "==> Removing files …"
ssh_cmd "$TARGET" '
	rm -f  /usr/bin/notifip
	rm -f  /etc/init.d/notifip
	rm -f  /etc/uci-defaults/99-notifip
	rm -f  /etc/hotplug.d/iface/30-notifip
	rm -f  /lib/upgrade/keep.d/luci-app-notifip
	rm -f  /usr/libexec/rpcd/luci.notifip
	rm -f  /usr/share/luci/menu.d/luci-app-notifip.json
	rm -f  /usr/share/rpcd/acl.d/luci-app-notifip.json
	rm -rf /www/luci-static/resources/view/notifip
	rm -rf /etc/notifip
	rm -f  /var/run/msmtp.notifip.conf /etc/msmtprc.notifip
	rm -f  /tmp/msmtp.notifip.log /tmp/notifip.booted
	rm -f  /etc/config/notifip
	[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload 2>/dev/null || true
'

echo "==> Done."

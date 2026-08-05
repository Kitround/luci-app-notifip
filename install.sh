#!/usr/bin/env bash
# luci-app-notifip — manual installer (no OpenWrt SDK required)
#
# Usage:
#   ./install.sh root@192.168.1.1            # default ssh port 22
#   ./install.sh root@192.168.1.1 -p 2222    # custom ssh port
#
# What it does:
#   1. Copies luci-app-notifip/{root,htdocs} to the router via tar over ssh
#   2. Applies the same modes the .ipk/.apk would (0755 / 0644 / 0600)
#   3. Installs missing dependencies via apk (OpenWrt >= 25.12) or opkg
#   4. Runs the uci-defaults script and starts the notifip service
#
# Assumes you can ssh as root to the router (key auth or you will be
# prompted for the password a few times).

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

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$HERE/luci-app-notifip"

if [ ! -d "$PKG_DIR/root" ]; then
	echo "package directory not found at $PKG_DIR" >&2
	exit 1
fi

echo "==> Copying files to $TARGET …"
# Same mapping luci.mk applies: root/ -> /, htdocs/ -> /www/.
# tar | ssh is more reliable than scp -r for preserving paths and modes.
(cd "$PKG_DIR/root" && tar -cf - .) \
	| ssh_cmd "$TARGET" 'tar -xf - -C /'
(cd "$PKG_DIR/htdocs" && tar -cf - .) \
	| ssh_cmd "$TARGET" 'mkdir -p /www && tar -xf - -C /www'

echo "==> Setting ownership and modes …"
ssh_cmd "$TARGET" '
	# tar preserved local UID/GID from the workstation — force root ownership
	chown -R 0:0 /usr/bin/notifip \
	             /etc/init.d/notifip \
	             /etc/uci-defaults/99-notifip \
	             /etc/hotplug.d/iface/30-notifip \
	             /lib/upgrade/keep.d/luci-app-notifip \
	             /usr/libexec/rpcd/luci.notifip \
	             /usr/share/luci/menu.d/luci-app-notifip.json \
	             /usr/share/rpcd/acl.d/luci-app-notifip.json \
	             /www/luci-static/resources/view/notifip \
	             /etc/config/notifip 2>/dev/null || true
	chmod 0755 /usr/bin/notifip \
	           /etc/init.d/notifip \
	           /etc/uci-defaults/99-notifip \
	           /usr/libexec/rpcd/luci.notifip
	# hotplug.d scripts are sourced, not executed; keep.d is plain data
	chmod 0644 /etc/hotplug.d/iface/30-notifip \
	           /lib/upgrade/keep.d/luci-app-notifip
	# Config holds the SMTP password — restrict to root
	chmod 0600 /etc/config/notifip 2>/dev/null || true
'

echo "==> Installing missing dependencies …"
ssh_cmd "$TARGET" '
	NEED=""
	command -v msmtp      >/dev/null 2>&1 || NEED="$NEED msmtp"
	command -v curl       >/dev/null 2>&1 || NEED="$NEED curl"
	command -v jsonfilter >/dev/null 2>&1 || NEED="$NEED jsonfilter"
	# ca-bundle enables real TLS certificate verification for SMTP
	if [ ! -f /etc/ssl/certs/ca-certificates.crt ] \
	&& [ ! -f /etc/ssl/cert.pem ] \
	&& [ ! -f /etc/ssl/certs/ca-bundle.crt ]; then
		NEED="$NEED ca-bundle"
	fi
	if [ -n "$NEED" ]; then
		echo "  Need: $NEED"
		# OpenWrt >= 25.12 ships apk, older releases ship opkg
		if command -v apk >/dev/null 2>&1; then
			apk update
			# shellcheck disable=SC2086
			apk add $NEED
		else
			opkg update
			# shellcheck disable=SC2086
			opkg install $NEED
		fi
	else
		echo "  All dependencies already present."
	fi
'

echo "==> Running uci-defaults and enabling notifip …"
ssh_cmd "$TARGET" '
	# Same script the package runs post-install: hardens the config, drops the
	# pre-1.2.0 /etc/msmtprc.notifip and reloads rpcd.
	if sh /etc/uci-defaults/99-notifip; then rm -f /etc/uci-defaults/99-notifip; fi
	/etc/init.d/cron enable    2>/dev/null || true
	/etc/init.d/cron start     2>/dev/null || true
	/etc/init.d/notifip enable 2>/dev/null || true
	/etc/init.d/notifip start  2>/dev/null || true
'

cat <<EOF

==> Installation done.

Open LuCI: http://<router>/  → Services → NotifIP
Configure SMTP, pick the mode, enable, Save & Apply, then "Send test mail".

Useful logs on the router:
  logread -e notifip
  cat /etc/notifip/changes.log
  cat /tmp/msmtp.notifip.log     # last msmtp run
EOF

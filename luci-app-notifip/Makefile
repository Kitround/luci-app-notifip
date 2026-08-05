#
# Copyright (C) 2026 Kitround
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=NotifIP - email notification when the WAN IP changes
LUCI_DESCRIPTION:=Sends an email over SMTP when the WAN IP changes. Watches either the public \
	IP through an ordered list of HTTP services, confirming any change against a second source \
	before alerting, or the local IPv4 of one or more interfaces through ubus. Cron plus WAN \
	ifup triggers, liveness mail after each reboot, change history in LuCI.
LUCI_DEPENDS:=+luci-base +jshn +msmtp +curl +jsonfilter +ca-bundle
LUCI_PKGARCH:=all

# luci.mk fills the package's MAINTAINER and URL fields from LUCI_MAINTAINER and
# LUCI_URL, not from PKG_MAINTAINER -- left unset, the package would ship claiming
# the LuCI community maintains it and link to openwrt/luci. PKG_MAINTAINER is set
# too because the packaging guidelines ask for it.
LUCI_MAINTAINER:=Kitround <github@krnd.fr>
LUCI_URL:=https://github.com/Kitround/luci-app-notifip

PKG_VERSION:=1.3.0
PKG_RELEASE:=1
PKG_MAINTAINER:=Kitround <github@krnd.fr>
PKG_LICENSE:=Apache-2.0

# Must precede luci.mk: it calls BuildPackage at the end of its own parse.
#
# The file holds the SMTP password in plaintext. luci.mk copies root/ with cp -pR
# and git only tracks the executable bit, so it lands as 0644; /etc/uci-defaults/
# 99-notifip tightens it to 0600, which default_postinst runs before the user can
# have entered a password. The init script and the worker re-assert the mode on
# every reload and every send.
define Package/luci-app-notifip/conffiles
/etc/config/notifip
endef

# No postinst/prerm block on purpose. luci.mk's default postinst already drops the
# LuCI caches and reloads rpcd, and default_postinst around it enables + starts
# /etc/init.d/notifip and runs /etc/uci-defaults/*; default_prerm stops and
# disables the service. Defining our own block would replace luci.mk's, not add
# to it.

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

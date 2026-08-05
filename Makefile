#
# Copyright 2026 Kitround
#
# SPDX-License-Identifier: Apache-2.0
#
# Build with the standard OpenWrt SDK / buildroot:
#   cp -r luci-app-notifip <sdk>/package/luci-app-notifip
#   cd <sdk> && make package/luci-app-notifip/compile V=s
#
# Produces a .ipk on 19.07 … 24.10 and a .apk on 25.12 and later; the recipe
# itself is package-manager agnostic.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-notifip
PKG_VERSION:=1.2.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Kitround <github@krnd.fr>
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-notifip
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=WAN IP change email notifier
  URL:=https://github.com/Kitround/luci-app-notifip
  DEPENDS:=+luci-base +jshn +msmtp +curl +jsonfilter +ca-bundle
  PKGARCH:=all
endef

define Package/luci-app-notifip/description
  NotifIP sends an email (SMTP) when the WAN IP changes.
  Configurable from LuCI: interval, mode (public IP or local interfaces),
  ordered source list with fallback and double-check, change history.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	# PKG_LICENSE_FILES is resolved against PKG_BUILD_DIR
	$(CP) ./LICENSE $(PKG_BUILD_DIR)/
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-notifip/conffiles
/etc/config/notifip
endef

define Package/luci-app-notifip/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/notifip $(1)/usr/bin/notifip

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/notifip $(1)/etc/init.d/notifip

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-notifip $(1)/etc/uci-defaults/99-notifip

	# 0600: the config holds the SMTP password in plaintext
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/notifip $(1)/etc/config/notifip

	# hotplug.d scripts are sourced, not executed -> 0644
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_DATA) ./files/etc/hotplug.d/iface/30-notifip $(1)/etc/hotplug.d/iface/30-notifip

	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./files/lib/upgrade/keep.d/luci-app-notifip $(1)/lib/upgrade/keep.d/luci-app-notifip

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./files/usr/libexec/rpcd/luci.notifip $(1)/usr/libexec/rpcd/luci.notifip

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-notifip.json $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-notifip.json $(1)/usr/share/rpcd/acl.d/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/notifip
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/notifip/*.js $(1)/www/luci-static/resources/view/notifip/
endef

# No custom postinst/prerm on purpose: the build system's default_postinst
# already enables + starts the init script, runs /etc/uci-defaults/* and drops
# the LuCI index cache, and default_prerm already stops + disables it.

$(eval $(call BuildPackage,luci-app-notifip))

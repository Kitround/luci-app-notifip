# NotifIP — OpenWRT package
# Build with the standard OpenWRT SDK / buildroot:
#   cp -r NotifIP <sdk>/package/luci-app-notifip
#   cd <sdk> && make package/luci-app-notifip/compile V=s

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-notifip
PKG_VERSION:=1.1.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=NotifIP

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-notifip
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=WAN IP change email notifier
  DEPENDS:=+luci-base +msmtp +curl +jsonfilter
  PKGARCH:=all
endef

define Package/luci-app-notifip/description
  NotifIP sends an email (SMTP) when the WAN IP changes.
  Configurable from LuCI: interval, mode (public IP or local interfaces),
  ordered source list with fallback and double-check, change history.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-app-notifip/conffiles
/etc/config/notifip
endef

define Package/luci-app-notifip/install
	$(CP) ./files/* $(1)/
	chmod 0755 $(1)/usr/bin/notifip
	chmod 0755 $(1)/etc/init.d/notifip
	chmod 0755 $(1)/etc/hotplug.d/iface/30-notifip
	chmod 0755 $(1)/usr/libexec/rpcd/luci.notifip
endef

define Package/luci-app-notifip/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

# Belt-and-braces: install msmtp if somehow missing
if ! command -v msmtp >/dev/null 2>&1; then
	opkg update >/dev/null 2>&1
	opkg install msmtp 2>/dev/null || true
fi

# Config holds the SMTP password — restrict to root
[ -f /etc/config/notifip ] && chmod 0600 /etc/config/notifip

# Reload rpcd so the new ACL + plugin are picked up
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload 2>/dev/null

# Enable and start the service (no-op if disabled in UCI)
/etc/init.d/notifip enable 2>/dev/null
/etc/init.d/notifip start  2>/dev/null

exit 0
endef

define Package/luci-app-notifip/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/notifip stop    2>/dev/null
/etc/init.d/notifip disable 2>/dev/null
exit 0
endef

$(eval $(call BuildPackage,luci-app-notifip))

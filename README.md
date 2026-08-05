# luci-app-notifip

LuCI app for OpenWrt that sends an email (SMTP) when the WAN IP changes.

- Choice between **public IP** (external HTTP services with fallback + double-check) or **local interface IP(s)**.
- Triggered by cron (configurable interval, default 5 min) **and** by hotplug `ifup` on WAN.
- Liveness mail on the first check after each reboot.
- No anti-flap: one real change = one mail.
- History viewable from LuCI.
- SMTP password stored in `/etc/config/notifip`, mode 0600.

## Requirements

- **OpenWrt 19.07 or newer**; built and released for **24.10** (`.ipk`) and **25.12** (`.apk`).
- `msmtp`, `curl`, `jsonfilter`, `jshn`, `ca-bundle` — pulled in automatically as package dependencies.

## Install

### Recommended — release package from GitHub

CI publishes a noarch `.ipk` and a noarch `.apk` on every tag.

**OpenWrt 25.12 and newer (apk):**

```sh
curl -fL -o /tmp/notifip.apk https://github.com/Kitround/luci-app-notifip/releases/latest/download/luci-app-notifip_all.apk
apk add --allow-untrusted /tmp/notifip.apk
rm /tmp/notifip.apk
```

**OpenWrt 24.10 and older (opkg):**

```sh
grep -q "^arch all " /etc/opkg.conf || echo "arch all 100" >> /etc/opkg.conf
opkg update
curl -fL -o /tmp/notifip.ipk https://github.com/Kitround/luci-app-notifip/releases/latest/download/luci-app-notifip_all.ipk
opkg install /tmp/notifip.ipk
rm /tmp/notifip.ipk
```

The `arch all` line is only needed because some firmwares (GL.iNet, custom forks) strip it from `/etc/opkg.conf`.

Future updates use the exact same command. `/etc/config/notifip` is declared as a conffile, so your SMTP and source settings survive upgrades, and `/etc/notifip` (state + history) is listed in `/lib/upgrade/keep.d` so it survives sysupgrade too.

### Alternative — `install.sh` script (dev/test, no SDK)

From a clone of this repo on your workstation:

```sh
./install.sh root@192.168.1.1
```

```sh
./install.sh root@192.168.1.1 -p 2222
```

The script copies `files/*` to `/` on the router with the same modes the package would apply, installs missing dependencies (apk or opkg, auto-detected), and enables the service. Useful when iterating on code, but it **overwrites** `/etc/config/notifip` — back up your SMTP settings first.

### Alternative — build the package yourself with the OpenWrt SDK

```sh
cp -r luci-app-notifip <openwrt-sdk>/package/luci-app-notifip
cd <openwrt-sdk> && make package/luci-app-notifip/compile V=s
```

The SDK produces a `.ipk` on 19.07 … 24.10 and a `.apk` on 25.12 and newer; the `Makefile` is the same either way.

## Configuration

In LuCI: **Services → NotifIP**.

- **Settings tab**: enable, interval, mode (public / interface), full SMTP config, recipient, **Check now** and **Send test mail** buttons.
- **Sources tab**: ordered list of URLs queried in "public IP" mode (defaults: `ipify`, `ifconfig.me`, `icanhazip`).
- **History tab**: current IP, table of changes, "Clear history" button.

Save & Apply **before** clicking "Send test mail" — the button uses the saved configuration.

## Logs

On the router:

```sh
logread -e notifip
```

```sh
cat /etc/notifip/changes.log
```

```sh
cat /tmp/msmtp.notifip.log
```

## Project structure

```
luci-app-notifip/
├── Makefile                                          # OpenWrt package (ipk + apk)
├── install.sh                                        # ssh-based manual installer
├── uninstall.sh                                      # mirror uninstaller
├── build-onrouter.sh                                 # generates a self-extracting installer
├── LICENSE                                           # Apache-2.0
├── files/
│   ├── etc/
│   │   ├── config/notifip                            # UCI defaults (0600)
│   │   ├── hotplug.d/iface/30-notifip                # WAN ifup trigger
│   │   ├── init.d/notifip                            # procd service, manages the cron line
│   │   └── uci-defaults/99-notifip                   # post-install fixups
│   ├── lib/upgrade/keep.d/luci-app-notifip           # keep state across sysupgrade
│   ├── usr/
│   │   ├── bin/notifip                               # main shell worker
│   │   ├── libexec/rpcd/luci.notifip                 # ubus backend for LuCI
│   │   └── share/
│   │       ├── luci/menu.d/luci-app-notifip.json     # LuCI menu entry
│   │       └── rpcd/acl.d/luci-app-notifip.json      # rpcd ACL
│   └── www/luci-static/resources/view/notifip/
│       ├── settings.js                               # Settings tab
│       ├── sources.js                                # Sources tab
│       └── history.js                                # History tab
└── README.md
```

## Uninstall

Installed as a package:

```sh
apk del luci-app-notifip
```

```sh
opkg remove luci-app-notifip
```

Installed manually:

```sh
./uninstall.sh root@192.168.1.1
```

## Troubleshooting

- **"msmtp not installed"** in logread → `apk add msmtp` / `opkg install msmtp`.
- **Test mail says Success but no email arrives** → check spam, then `/tmp/msmtp.notifip.log` (often a server rejection after a successful auth).
- **`no CA bundle found` warning in logread** → the SMTP server certificate is not being verified. Install `ca-bundle`; it is a package dependency, so this only happens on manual installs.
- **Empty tab after install** → `/etc/init.d/rpcd reload`, then hard-refresh the browser (Ctrl+F5).
- **535 Authentication failed (OVH, Gmail, …)** → wrong password, 2FA requires an app password, or SMTP auth is disabled on the mailbox.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

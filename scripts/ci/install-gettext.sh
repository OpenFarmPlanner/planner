#!/usr/bin/env bash
set -euo pipefail

if command -v msgfmt >/dev/null 2>&1 && msgfmt --version >/dev/null 2>&1; then
  echo "A working msgfmt is already installed."
  exit 0
fi

# sudo normally drops these variables. Keep configured network access for apt
# without printing proxy URLs, which may contain credentials.
proxy_variables=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,no_proxy,NO_PROXY
if [[ -n "${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}" ]]; then
  echo "Installing gettext with the configured HTTP(S) proxy."
else
  echo "Installing gettext without an HTTP(S) proxy."
fi

apt_options=(-o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o Acquire::Retries=1)
# Run timeout as root too, so a timed-out apt process cannot retain its locks.
sudo --preserve-env="$proxy_variables" timeout --kill-after=5s 180s \
  apt-get "${apt_options[@]}" update
sudo --preserve-env="$proxy_variables" timeout --kill-after=5s 180s \
  apt-get "${apt_options[@]}" install -y gettext

msgfmt --version

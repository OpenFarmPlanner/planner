#!/usr/bin/env bash
set -euo pipefail

run_apt() {
  # sudo normally drops proxy variables; keep configured network access without
  # printing proxy URLs, which may contain credentials. Root timeout can kill apt.
  sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,no_proxy,NO_PROXY \
    timeout --kill-after=5s 180s apt-get \
    -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o Acquire::Retries=1 "$@"
}

ubuntu_codename() {
  local ID='' VERSION_CODENAME=''
  # This is the runner's trusted system release metadata, not repository data.
  source /etc/os-release
  [[ "$ID" == ubuntu && "$VERSION_CODENAME" =~ ^[a-z]+$ ]] || return 1
  printf '%s\n' "$VERSION_CODENAME"
}

install_from_mirror() (
  set -e
  local codename="$1" sources_dir
  sources_dir="$(mktemp -d)"
  trap 'rm -rf -- "$sources_dir"' EXIT
  # Use an alternate Ubuntu archive mirror with Ubuntu's existing signing key.
  # These per-command sources never replace the runner's system configuration.
  printf 'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://mirrors.edge.kernel.org/ubuntu/ %s main\n' \
    "$codename" "$codename-updates" "$codename-security" > "$sources_dir/sources.list"
  local source_options=(
    -o "Dir::Etc::sourcelist=$sources_dir/sources.list"
    -o Dir::Etc::sourceparts=-
    -o APT::Get::List-Cleanup=0
  )
  run_apt "${source_options[@]}" -o APT::Update::Error-Mode=any update
  run_apt "${source_options[@]}" install -y gettext
)

main() {
  if command -v msgfmt >/dev/null 2>&1 && msgfmt --version >/dev/null 2>&1; then
    echo 'A working msgfmt is already installed.'
    return 0
  fi
  if [[ -n "${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}" ]]; then
    echo 'Installing gettext with the configured HTTP(S) proxy.'
  else
    echo 'Installing gettext without an HTTP(S) proxy.'
  fi
  local default_status codename
  if run_apt -o APT::Update::Error-Mode=any update && run_apt install -y gettext; then
    msgfmt --version
    return
  else
    default_status=$?
  fi
  codename="$(ubuntu_codename)" || return "$default_status"
  echo 'Default Ubuntu archive setup failed; trying the signed Ubuntu archive through an alternate mirror.'
  install_from_mirror "$codename"
  msgfmt --version
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi

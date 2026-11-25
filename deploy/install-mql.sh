#!/bin/sh
# Installs/updates the MQL sandbox service from the checked-out repo. Run as root on the VPS.
set -e
SRC=/ssd/www/personalmetatrader
id pmtmql >/dev/null 2>&1 || useradd -r -M -d /nonexistent -s /usr/sbin/nologin pmtmql
mkdir -p /opt/pmt-mql
cp "$SRC"/mql/*.js /opt/pmt-mql/
mkdir -p /opt/pmt-mql/pine && cp "$SRC"/pine/*.js /opt/pmt-mql/pine/
cp "$SRC"/public/assets/indicators.js /opt/pmt-mql/indicators.js
chown -R root:root /opt/pmt-mql && chmod -R go-w /opt/pmt-mql
if [ ! -f /etc/pmt-mql.env ]; then
  SECRET=$(openssl rand -hex 24)
  printf 'MQL_PORT=18090\nMQL_SECRET=%s\n' "$SECRET" > /etc/pmt-mql.env
  chmod 600 /etc/pmt-mql.env
  # the PHP app needs the same secret
  grep -q '^MQL_SECRET=' "$SRC/.env" || printf 'MQL_URL=http://127.0.0.1:18090\nMQL_SECRET=%s\n' "$SECRET" >> "$SRC/.env"
fi
cp "$SRC"/deploy/pmt-mql.service /etc/systemd/system/pmt-mql.service
systemctl daemon-reload
systemctl enable pmt-mql >/dev/null 2>&1
systemctl restart pmt-mql
sleep 1
systemctl is-active pmt-mql

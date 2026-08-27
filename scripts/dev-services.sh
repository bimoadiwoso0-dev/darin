#!/usr/bin/env bash
# اطمینان از در دسترس بودن PostgreSQL و Redis برای محیط توسعه.
# در محیط‌های موقت (Container، Codespace) این سرویس‌ها ممکن است بین جلسات
# متوقف شوند؛ این اسکریپت آنها را دوباره بالا می‌آورد.
set -uo pipefail

ok=0

if pg_isready -q 2>/dev/null; then
  echo "✔ PostgreSQL در دسترس است"
else
  echo "… راه‌اندازی PostgreSQL"
  pg_ctlcluster 16 main start >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1
  for _ in $(seq 1 15); do
    sleep 1
    pg_isready -q 2>/dev/null && break
  done
  pg_isready -q 2>/dev/null && echo "✔ PostgreSQL بالا آمد" || { echo "✖ PostgreSQL بالا نیامد"; ok=1; }
fi

if redis-cli ping >/dev/null 2>&1; then
  echo "✔ Redis در دسترس است"
else
  echo "… راه‌اندازی Redis"
  redis-server --daemonize yes --save '' --appendonly no >/dev/null 2>&1
  sleep 2
  if redis-cli ping >/dev/null 2>&1; then
    echo "✔ Redis بالا آمد"
  else
    # Redis اختیاری است: سامانه با QUEUE_ENABLED=false هم کامل کار می‌کند
    echo "! Redis در دسترس نیست — کارهای پس‌زمینه به‌صورت همزمان اجرا می‌شوند"
  fi
fi

exit $ok

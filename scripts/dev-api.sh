#!/usr/bin/env bash
# راه‌اندازی سرویس API برای توسعه و تست دستی.
#
#   scripts/dev-api.sh restart   → توقف نمونه قبلی، Build و اجرای دوباره
#   scripts/dev-api.sh start|stop|status|logs
#
# نکته: شناسه فرایند در یک PID file نگهداری می‌شود و از `pgrep -f` استفاده
# نمی‌کنیم، چون الگوی جستجو با خط فرمان خودِ این اسکریپت هم تطابق می‌کند و
# اسکریپت خودش را می‌کشد.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/apps/api"
LOG="${DARIN_API_LOG:-/tmp/darin-api.log}"
PID_FILE="${DARIN_API_PID:-/tmp/darin-api.pid}"
PORT="${API_PORT:-3001}"
HEALTH="http://localhost:${PORT}/api/health/live"

is_up() { curl -sf "$HEALTH" >/dev/null 2>&1; }

stop_api() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 15); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  # اگر PID file گم یا کهنه شده ولی پورت هنوز اشغال است (مثلاً پس از یک اجرای
  # دستی)، فرایند باقی‌مانده را از فهرست فرایندها پیدا می‌کنیم.
  # از `ps` استفاده می‌شود نه `pgrep -f`، چون الگوی pgrep با خط فرمان خود این
  # اسکریپت هم تطابق می‌کند و باعث می‌شود اسکریپت خودش را بکشد.
  if is_up; then
    local stragglers
    stragglers="$(ps -eo pid=,cmd= | grep -E '[n]ode .*main\.js' | awk '{print $1}')"
    for pid in $stragglers; do
      [[ "$pid" == "$$" ]] && continue
      kill "$pid" 2>/dev/null || true
    done
    for _ in $(seq 1 10); do
      is_up || break
      sleep 1
    done
  fi
}

start_api() {
  # سرویس‌های وابسته ممکن است بین جلسات متوقف شده باشند
  bash "$ROOT/scripts/dev-services.sh" >/dev/null 2>&1 || true
  cd "$API_DIR" || return 1
  nohup node dist/main.js >"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  for i in $(seq 1 30); do
    sleep 1
    if is_up; then
      echo "✔ API آماده است (${i}s) — PID $(cat "$PID_FILE") — لاگ: $LOG"
      return 0
    fi
  done
  echo "✖ API بالا نیامد. آخرین خطوط لاگ:"
  tail -20 "$LOG"
  return 1
}

case "${1:-restart}" in
  stop)   stop_api; echo "✔ API متوقف شد" ;;
  start)  start_api ;;
  logs)   tail -f "$LOG" ;;
  status)
    if is_up; then echo "✔ در حال اجرا (PID $(cat "$PID_FILE" 2>/dev/null || echo '?'))"
    else echo "✖ متوقف"; fi
    ;;
  restart)
    stop_api
    echo "در حال Build..."
    if ! (cd "$API_DIR" && pnpm build >/tmp/darin-build.log 2>&1); then
      echo "✖ Build ناموفق:"; tail -25 /tmp/darin-build.log; exit 1
    fi
    start_api
    ;;
  *) echo "استفاده: $0 {restart|start|stop|status|logs}"; exit 1 ;;
esac

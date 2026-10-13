#!/usr/bin/env bash
#
# Сборка релизного APK «Ё-новостей» для RuStore.
#
# Запуск: bash scripts/build-rustore.sh  (или ./scripts/build-rustore.sh)
#
# Скрипт рассчитан на машину разработчика с Android SDK и JDK, а не на сервер: на VPS ни того, ни
# другого нет, и держать там Android-тулчейн незачем — веб-часть деплоится через `deploy.sh`, а APK
# собирается отдельно и заливается в RuStore руками.
#
# Что он проверяет перед сборкой и почему именно это:
#   - gradle wrapper — без него `./gradlew` не запустится вовсе;
#   - JDK — Capacitor компилирует под Java 21, и на более старом JDK падает в самом начале;
#   - Android SDK — самая частая причина «Gradle не находит sdk.dir»: путь к SDK не задан ни в
#     переменной окружения, ни в `android/local.properties`. Сообщение об этом Gradle пишет
#     длинным стектрейсом, в котором причина не видна.
#
# Выпускается `app-release-unsigned.apk`: подпись — отдельный шаг. RuStore умеет подписывать
# приложение своими ключами при публикации, а если подпись нужна локальная, её добавляют в
# `android/app/build.gradle` (signingConfigs) — скрипт этого не делает, чтобы не тащить секреты в
# репозиторий.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"

fail() {
  echo "ОШИБКА: $*" >&2
  exit 1
}

# --- окружение ------------------------------------------------------------------

[ -d "$ANDROID_DIR" ] || fail "нет каталога android/. Выполните: npx cap add android"

GRADLEW="$ANDROID_DIR/gradlew"
if [ ! -f "$GRADLEW" ]; then
  if [ -f "$ANDROID_DIR/gradlew.bat" ]; then
    GRADLEW="$ANDROID_DIR/gradlew.bat"
  else
    fail "не найден gradle wrapper (ожидался android/gradlew или android/gradlew.bat)"
  fi
fi
# Клон на Windows теряет бит исполнения — возвращаем его молча.
[ -x "$GRADLEW" ] || chmod +x "$GRADLEW" 2>/dev/null || true

command -v java >/dev/null 2>&1 \
  || fail "java не найдена в PATH. Нужен JDK 21 (Capacitor компилирует под Java 21)"
echo "Java:    $(java -version 2>&1 | head -1)"

SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK_DIR" ] && [ -f "$ANDROID_DIR/local.properties" ]; then
  SDK_DIR="$(grep -E '^sdk\.dir=' "$ANDROID_DIR/local.properties" | cut -d= -f2- | tr -d '\\' || true)"
fi
if [ -z "$SDK_DIR" ]; then
  fail "Android SDK не найден. Задайте ANDROID_HOME (или ANDROID_SDK_ROOT), либо создайте android/local.properties со строкой sdk.dir=/путь/к/Android/sdk"
fi
[ -d "$SDK_DIR" ] || fail "каталог Android SDK не существует: $SDK_DIR"
echo "SDK:     $SDK_DIR"

# --- синхронизация и сборка -----------------------------------------------------

echo
echo "==> npx cap sync android"
(cd "$ROOT_DIR" && npx cap sync android)

echo
echo "==> ./gradlew assembleRelease"
(cd "$ANDROID_DIR" && "$GRADLEW" assembleRelease)

# --- результат ------------------------------------------------------------------

OUT_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
APK="$(find "$OUT_DIR" -maxdepth 1 -name '*.apk' 2>/dev/null | sort | head -1 || true)"
[ -n "$APK" ] || fail "APK не найден после сборки: $OUT_DIR"

echo
echo "Готово. APK: $APK"
ls -lh "$APK"

echo
echo "Дальше: подпишите APK (если RuStore не подписывает сам) и загрузите в консоль RuStore."

/**
 * Упаковка в Android-приложение для RuStore: оболочка Capacitor и push-токены.
 *
 * Проверка читает файлы, а не собирает APK: Android-сборка требует SDK и Gradle, а `npx cap sync`
 * только копирует файлы. То, что здесь утверждается, — это связность конфигурации: без неё APK
 * соберётся, но push-канал молча не заработает, а заметить это можно лишь на живом устройстве.
 */
import { existsSync, readFileSync } from "node:fs";

const read = (relative: string) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

// --- оболочка Capacitor ---------------------------------------------------------

const config = read("capacitor.config.ts");
check(
  "Оболочка: appId и адрес сайта из задания",
  config.includes('appId: "ru.eartnews.app"') &&
    config.includes('"https://eartnews.ru"') &&
    config.includes('webDir: "public"') &&
    config.includes("cleartext: false"),
  "ru.eartnews.app → https://eartnews.ru",
);

check(
  "Оболочка: android/ создан (npx cap add android)",
  existsSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url)),
  "AndroidManifest.xml на месте",
);

// --- безопасные зоны WebView ----------------------------------------------------

const rootLayout = read("src/app/layout.tsx");
check(
  "WebView: viewport-fit=cover и нижний safe-area",
  /viewportFit:\s*"cover"/.test(rootLayout) &&
    rootLayout.includes("pb-[env(safe-area-inset-bottom)]"),
  "viewportFit + env(safe-area-inset-bottom)",
);

const headerShell = read("src/components/header-shell.tsx");
const ribbon = read("src/components/reading-ribbon.tsx");
check(
  "WebView: шапка и полоса чтения учитывают вырез сверху",
  headerShell.includes("pt-[env(safe-area-inset-top)]") &&
    ribbon.includes("env(safe-area-inset-top)") &&
    headerShell.includes("top-[calc(52px+env(safe-area-inset-top))]"),
  "шапка + панель разделов + полоса",
);

// --- кнопка «Назад» -------------------------------------------------------------

const nativeShell = read("src/components/native-shell.tsx");
check(
  "Нативный слой: аппаратная «Назад» идёт по истории, потом выход",
  nativeShell.includes('"backButton"') &&
    nativeShell.includes("canGoBack") &&
    nativeShell.includes("history.back()") &&
    nativeShell.includes("exitApp"),
  "backButton → история → exitApp",
);
check(
  "Нативный слой: кнопка «Назад» подключена к корневому макету",
  rootLayout.includes("NativeShell") && rootLayout.includes("<NativeShell />"),
  "NativeShell в layout",
);

// --- PushToken и эндпоинт -------------------------------------------------------

const schema = read("prisma/schema.prisma");
check(
  "Push: модель PushToken с уникальным токеном",
  /model PushToken\s*\{/.test(schema) &&
    /token\s+String\s+@unique/.test(schema) &&
    /platform\s+String\s+@default\("rustore"\)/.test(schema),
  "PushToken(token @unique, platform, createdAt)",
);

const registerRoute = "src/app/api/push/register/route.ts";
check(
  "Push: эндпоинт регистрации токена принимает POST",
  existsSync(new URL(`../${registerRoute}`, import.meta.url)) &&
    read(registerRoute).includes("export async function POST"),
  "POST /api/push/register",
);

// --- нативная часть RuStore -----------------------------------------------------

const rootGradle = read("android/build.gradle");
check(
  "Push SDK: репозиторий RuStore объявлен (новый адрес + запасной VK)",
  rootGradle.includes("nexus-external.rustore.ru/repository/maven-rustore-exposed") &&
    rootGradle.includes("artifactory-external.vkpartner.ru/artifactory/maven"),
  "nexus-external + artifactory-external",
);

const appGradle = read("android/app/build.gradle");
check(
  "Push SDK: зависимость pushclient и Kotlin-плагин",
  appGradle.includes("ru.rustore.sdk:pushclient") && appGradle.includes("kotlin-android"),
  "pushclient + kotlin-android",
);

const manifest = read("android/app/src/main/AndroidManifest.xml");
check(
  "Push SDK: служба и её intent-filter объявлены в манифесте",
  manifest.includes('android:name=".RuStoreMessagingService"') &&
    manifest.includes("ru.rustore.sdk.pushclient.MESSAGING_EVENT") &&
    manifest.includes("android.permission.POST_NOTIFICATIONS"),
  "service + MESSAGING_EVENT + POST_NOTIFICATIONS",
);

check(
  "Push SDK: ID проекта подставлен (не заглушка)",
  /ru\.rustore\.sdk\.pushclient\.project_id"[^>]*android:value="(?!REPLACE_)[^"]+"/.test(manifest) &&
    !manifest.includes("REPLACE_WITH_RUSTORE_PROJECT_ID"),
  "project_id заполнен боевым значением",
);

const messagingService =
  "android/app/src/main/java/ru/eartnews/app/RuStoreMessagingService.kt";
const service = read(messagingService);
check(
  "Push: сервис регистрирует токен и рисует уведомление",
  service.includes("override fun onNewToken") &&
    service.includes("override fun onMessageReceived") &&
    service.includes("override fun onError") &&
    service.includes("registerToken("),
  "onNewToken + onMessageReceived + onError",
);
check(
  "Push: суперкласс службы взят из пакета messaging.service",
  service.includes(
    "ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService()",
  ) && !/ru\.rustore\.sdk\.pushclient\.messaging\.RuStoreMessagingService/.test(service),
  "супертип messaging.service (проверено по классам pushclient)",
);
check(
  "Push: уведомление идёт в свой канал, клик открывает статью",
  service.includes("yo_news_urgent") &&
    service.includes("NotificationChannel") &&
    service.includes("PendingIntent.getActivity") &&
    service.includes("Intent.ACTION_VIEW"),
  "канал yo_news_urgent + PendingIntent → ACTION_VIEW",
);
check(
  "Push: берётся иконка шторки, а не белый квадрат",
  service.includes("R.drawable.ic_stat_push") &&
    existsSync(new URL("../android/app/src/main/res/drawable/ic_stat_push.xml", import.meta.url)),
  "ic_stat_push в сервисе и в ресурсах",
);

const mainActivity = read("android/app/src/main/java/ru/eartnews/app/MainActivity.java");
check(
  "Push: согласие на уведомления спрашивается у пользователя",
  mainActivity.includes("POST_NOTIFICATIONS") &&
    mainActivity.includes("requestPermissions") &&
    mainActivity.includes("TIRAMISU"),
  "MainActivity → runtime-запрос POST_NOTIFICATIONS",
);

check(
  "Push: клик по уведомлению открывает статью внутри приложения",
  nativeShell.includes('"appUrlOpen"') && nativeShell.includes("window.location.assign"),
  "appUrlOpen → переход на адрес статьи",
);

check(
  "Сборка: скрипт релизного APK для RuStore",
  existsSync(new URL("../scripts/build-rustore.sh", import.meta.url)) &&
    read("scripts/build-rustore.sh").includes("assembleRelease"),
  "scripts/build-rustore.sh → assembleRelease",
);

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
if (failed.length > 0) process.exit(1);

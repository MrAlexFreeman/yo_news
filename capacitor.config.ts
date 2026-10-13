import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Конфигурация Android-оболочки для RuStore.
 *
 * **Это WebView-обёртка, а не офлайн-приложение.** `server.url` указывает на боевой сайт, и
 * приложение показывает его как есть — свежие новости появляются без пересборки и без ревью
 * магазина. `webDir: "public"` при этом не пустой формальности ради: Capacitor требует
 * существующий каталог как «локальную» сборку, и он же содержит `manifest.json` и иконки,
 * которые нужны приложению.
 *
 * `cleartext: false` — приложение ходит только по HTTPS. Сайт редиректит `http` на `https`, но
 * разрешать незашифрованный трафик в обёртке незачем: это открыло бы путь для подмены ответа на
 * публичном Wi-Fi.
 */
const config: CapacitorConfig = {
  appId: "ru.eartnews.app",
  appName: "Ё-новости",
  webDir: "public",
  server: {
    url: "https://eartnews.ru",
    cleartext: false,
  },
  android: {
    // Смешанный контент запрещён: страница загружается по https и не должна тянуть http-ресурсы.
    allowMixedContent: false,
  },
};

export default config;

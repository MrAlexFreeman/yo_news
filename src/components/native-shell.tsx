"use client";

import { useEffect } from "react";

/**
 * Мост между сайтом и нативной оболочкой RuStore.
 *
 * **Почему через глобальный `window.Capacitor`, а не через импорт `@capacitor/app`.** Пакеты
 * `@capacitor/*` — это тонкие типизированные обёртки над мостом, который Capacitor и так
 * впрыскивает в каждый загруженный документ. Импорт втянул бы их JS в бандл сайта, который
 * получают все читатели в браузере, тогда как в оболочке живёт меньшинство. Глобальный мост
 * доступен только внутри приложения, поэтому здесь код либо работает, либо (в браузере) сразу
 * выходит по первой проверке.
 *
 * **Кнопка «Назад».** Без обработчика аппаратная кнопка на Android закрывает приложение с любого
 * экрана — включая середину статьи, куда читатель пришёл по ссылке. Обработчик отдаёт назад
 * сначала истории WebView (`canGoBack` считает Capacitor) и выходит из приложения только с
 * первой страницы, что и ожидает читатель.
 *
 * **Статус-бар.** Контент уводится под системную строку (`overlaysWebView`), иначе `env(safe-area-
 * inset-*)` в CSS остаются нулями, и отступы под вырез не появляются вовсе. Иконки — тёмные:
 * сайт светлый.
 */
type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    App?: {
      addListener?: (
        event: "backButton",
        callback: (data: { canGoBack: boolean }) => void,
      ) => Promise<{ remove: () => void }>;
      exitApp?: () => void;
    };
    StatusBar?: {
      setOverlaysWebView?: (options: { overlay: boolean }) => unknown;
      setStyle?: (options: { style: string }) => unknown;
    };
  };
};

export function NativeShell() {
  useEffect(() => {
    const bridge = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
    // В обычном браузере моста нет — выходим сразу, ничего не навешивая.
    if (!bridge?.isNativePlatform?.()) return;

    const statusBar = bridge.Plugins?.StatusBar;
    try {
      void statusBar?.setOverlaysWebView?.({ overlay: true });
      // `LIGHT` — тёмные иконки для светлого фона (в терминах Capacitor это «light background»).
      void statusBar?.setStyle?.({ style: "LIGHT" });
    } catch {
      // Плагина может не быть в сборке — это не повод ронять страницу.
    }

    const app = bridge.Plugins?.App;
    let listener: { remove: () => void } | undefined;

    const subscription = app?.addListener?.("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void app.exitApp?.();
      }
    });

    void subscription?.then((handle) => {
      listener = handle;
    });

    return () => {
      listener?.remove();
    };
  }, []);

  return null;
}

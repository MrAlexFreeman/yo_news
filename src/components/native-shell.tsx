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
        event: "backButton" | "appUrlOpen",
        callback: (data: { canGoBack: boolean; url?: string }) => void,
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
    const listeners: { remove: () => void }[] = [];

    const back = app?.addListener?.("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void app.exitApp?.();
      }
    });

    /*
      Переход по уведомлению.

      Сервис RuStore отправляет уведомление с `ACTION_VIEW` и адресом статьи; Capacitor отдаёт
      этот интент странице как `appUrlOpen`. Без обработчика клик по уведомлению открыл бы
      приложение на главной, и читатель искал бы новость сам.

      Адрес проверяется на свой origin: чужую ссылку из пейлоада в WebView грузить нельзя —
      приложение превратилось бы в браузер для любого адреса, который попадёт в пуш.
    */
    const open = app?.addListener?.("appUrlOpen", ({ url }) => {
      if (!url) return;
      try {
        const target = new URL(url);
        if (target.origin !== window.location.origin) return;
        window.location.assign(target.toString());
      } catch {
        // Не URL — не повод что-то делать.
      }
    });

    for (const subscription of [back, open]) {
      void subscription?.then((handle) => listeners.push(handle));
    }

    return () => {
      for (const handle of listeners) handle.remove();
    };
  }, []);

  return null;
}

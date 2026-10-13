package ru.eartnews.app

import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Приём push-уведомлений RuStore.
 *
 * **Что делает этот сервис.** RuStore показывает готовое уведомление в шторке сам, если пуш
 * пришёл с заполненным `notification`; приложению для базовой доставки не нужно рисовать
 * нотификацию вручную. Единственное, что обязательно делает приложение, — это передаёт свежий
 * push-токен на свой сервер, чтобы редакция знала, куда отправлять. Этим занят `onNewToken`.
 *
 * **Почему только `onNewToken` переопределён, а не все четыре метода.** `RemoteMessage`,
 * `RuStorePushClientException` и их пакеты привязаны к версии SDK; каждый лишний тип — это лишний
 * шанс не собраться на версии, которая чуть отличается от документации. Доставка в шторку от
 * `onMessageReceived` не зависит, поэтому здесь только то, без чего нельзя: регистрация токена.
 * Остальные хуки оставлены закомментированными шаблонами ниже — их включают, когда нужна
 * собственная обработка `data`-пейлоада или синхронизация после потери сообщений.
 *
 * **Имя класса совпадает с суперклассом SDK намеренно.** Задание просило файл
 * `RuStoreMessagingService.kt`; супертип указан полным именем, поэтому совпадения простых имён не
 * возникает. Если это покажется неудобным, класс можно переименовать в `EartnewsPushService` и
 * так же поправить `AndroidManifest.xml` — больше ничего не изменится.
 */
class RuStoreMessagingService : ru.rustore.sdk.pushclient.messaging.RuStoreMessagingService() {

    override fun onNewToken(token: String) {
        Log.i(TAG, "Получен новый push-токен RuStore, отправляю на сервер")
        registerToken(token)
    }

    /*
      Шаблоны остальных хуков — раскомментировать по мере надобности.

      override fun onMessageReceived(message: RemoteMessage) {
          // Если пуш пришёл только с `data` (без `notification`), шторку рисует приложение.
          // Пейлоад лежит в `message.data` — это Map<String, String>.
      }

      override fun onDeletedMessages() {
          // Часть уведомлений не доехала (истёк TTL). Стоит синхронизироваться с сервером.
      }

      override fun onError(errors: List<RuStorePushClientException>) {
          // UnauthorizedException / HostAppNotInstalledException /
          // HostAppBackgroundWorkPermissionNotGranted — не фатально, но стоит логировать.
      }
    */

    /**
     * Отправляет токен на `/api/push/register`.
     *
     * В фоновом потоке: колбэки SDK приходят на своём потоке, и сетевая работа в них заблокировала
     * бы приём следующих сообщений. Ошибка сети не пробрасывается — токен будет выдан заново при
     * следующем запуске, а падать из-за недоступного сервера сервису незачем.
     */
    private fun registerToken(token: String) {
        thread(name = "push-token-register") {
            var connection: HttpURLConnection? = null
            try {
                val url = URL("$BACKEND_BASE/api/push/register")
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }

                val body = """{"token":${quote(token)},"platform":"rustore"}"""
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

                val code = connection.responseCode
                Log.i(TAG, "Регистрация токена: HTTP $code")
            } catch (error: Exception) {
                Log.w(TAG, "Не удалось зарегистрировать push-токен: ${error.message}")
            } finally {
                connection?.disconnect()
            }
        }
    }

    /** Кавычка и обратный слэш — единственное, что в JSON-строке нужно экранировать. */
    private fun quote(value: String): String {
        val escaped = value.replace("\\", "\\\\").replace("\"", "\\\"")
        return "\"$escaped\""
    }

    private companion object {
        const val TAG = "EartnewsPush"
        /** Боевой адрес сайта: токен регистрируется на том же домене, что и сама витрина. */
        const val BACKEND_BASE = "https://eartnews.ru"
    }
}

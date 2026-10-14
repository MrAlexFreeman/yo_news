package ru.eartnews.app

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ru.rustore.sdk.pushclient.messaging.exception.RuStorePushClientException
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Push-уведомления RuStore «Ё-новостей».
 *
 * Сервис делает две вещи: отдаёт свежий токен на сервер редакции (`onNewToken`) и рисует
 * уведомление в шторке Android (`onMessageReceived`).
 *
 * **Пейлоад договорённостью data-only.** SDK RuStore сам рисует уведомление, если в пуше есть
 * готовый объект `notification` (у него для этого есть свой канал «Miscellaneous» и своя иконка),
 * и в этом же случае вызывает `onMessageReceived`. Поэтому сервис показывает своё уведомление
 * только когда `notification` пуст — иначе читатель получит два уведомления об одной новости.
 * Рассылка с сервера шлёт `data` с полями `title`, `body`, `url` (или `slug`): так канал,
 * важность, иконка и переход по клику остаются под контролем приложения, а не SDK.
 *
 * **Имя класса совпадает с суперклассом SDK намеренно** — файл назван по заданию. Супертип указан
 * полным именем, поэтому совпадения простых имён не возникает; пакет `messaging.service` (а не
 * `messaging`) проверен по классам самого pushclient.
 */
class RuStoreMessagingService : ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService() {

    override fun onNewToken(token: String) {
        Log.i(TAG, "Получен новый push-токен RuStore, отправляю на сервер")
        registerToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Готовое уведомление от SDK: не дублируем его своим.
        if (message.notification != null) {
            Log.i(TAG, "Уведомление нарисовано SDK — своё не показываем")
            return
        }

        val data = message.data
        val title = data["title"]?.takeIf { it.isNotBlank() } ?: "Ё-новости"
        val body = data["body"]?.takeIf { it.isNotBlank() }

        if (body == null) {
            Log.w(TAG, "Пуш без title/body — показывать нечего")
            return
        }

        showNotification(title, body, articleUrl(data))
    }

    override fun onDeletedMessages() {
        /*
          Часть уведомлений не доехала — обычно истёк TTL. Сервер об этом не знает, и читатель
          мог пропустить новость; правильный ответ — синхронизироваться при следующем запуске.
          Здесь только след в логе: сетевую синхронизацию дёргает экран приложения, а не сервис.
        */
        Log.i(TAG, "Часть уведомлений не доставлена — стоит обновить ленту при запуске")
    }

    /**
     * Ошибки канала push.
     *
     * `isCritical` из самого SDK отделяет «пуш не пришёл, потому что RuStore не установлен или не
     * пущен в фон» от разовых сбоев сети. Первое — состояние устройства, и читателю о нём сообщает
     * сам SDK своим экраном; в логе достаточно уровня, чтобы не путать одно с другим.
     * Исключения не пробрасываются: сервис живёт в системном процессе, и падение здесь ничего не
     * лечит, а только снимает подписку целиком.
     */
    override fun onError(errors: List<RuStorePushClientException>) {
        for (error in errors) {
            val level = if (error.isCritical) "критично" else "несмертельно"
            Log.w(TAG, "Ошибка push-канала ($level): ${error.message}")
        }
    }

    // --- уведомление ------------------------------------------------------------

    /**
     * Собирает и показывает уведомление в канале «Срочные новости».
     *
     * Переход по клику — `ACTION_VIEW` с адресом статьи: Capacitor отдаёт такой интент странице
     * как `appUrlOpen`, и она открывает нужный материал вместо главной. Если адреса нет вовсе,
     * открывается сайт целиком — уведомление без действия хуже, чем переход на главную.
     */
    private fun showNotification(title: String, body: String, url: String) {
        // Канал создаётся тем же кодом, что и при запуске приложения, — см. PushNotifications.
        PushNotifications.ensureChannel(this)

        val open = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse(url)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pending = PendingIntent.getActivity(
            this,
            url.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, PushNotifications.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_push)
            .setContentTitle(title)
            .setContentText(body)
            // Длинный текст разворачивается в шторке целиком, а не обрезается одной строкой.
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        try {
            // Идентификатор привязан к адресу: повторный пуш о той же новости обновит уведомление,
            // а не положит второе рядом.
            NotificationManagerCompat.from(this).notify(url.hashCode(), notification)
        } catch (error: SecurityException) {
            // POST_NOTIFICATIONS не выдан пользователем. Это не сбой приложения: показ уведомлений
            // — его право, а не обязанность, и падать из-за отказа нельзя.
            Log.w(TAG, "Показ уведомлений запрещён пользователем: ${error.message}")
        }
    }

    /** Адрес статьи из пейлоада: `url`, иначе собранный из `slug`, иначе главная. */
    private fun articleUrl(data: Map<String, String>): String {
        val url = data["url"]?.trim()
        if (!url.isNullOrEmpty()) return if (url.startsWith("http")) url else "$SITE$url"

        val slug = data["slug"]?.trim()
        if (!slug.isNullOrEmpty()) return "$SITE/news/$slug"

        return SITE
    }

    // --- регистрация токена -----------------------------------------------------

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
                val url = URL("$SITE/api/push/register")
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }

                val body = """{"token":${quote(token)},"platform":"rustore"}"""
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

                Log.i(TAG, "Регистрация токена: HTTP ${connection.responseCode}")
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

        /** Боевой адрес сайта: и токен регистрируется на нём, и статьи открываются с него. */
        const val SITE = "https://eartnews.ru"
    }
}

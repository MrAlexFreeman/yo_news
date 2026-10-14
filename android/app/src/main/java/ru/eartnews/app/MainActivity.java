package ru.eartnews.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Оболочка приложения.
 *
 * Единственное, что здесь добавлено к шаблону Capacitor, — запрос разрешения на уведомления.
 *
 * С Android 13 показ уведомлений требует согласия пользователя, и запросить его может только
 * Activity: сервис приёма пушей этого не умеет, а объявленное в манифесте разрешение само по себе
 * ничего не даёт. Без запроса RuStore-пуши приходили бы в приложение и молча не показывались —
 * самый неприятный вид поломки, потому что со стороны сервера всё выглядит отправленным.
 *
 * Отказ — не ошибка: пользователь вправе не хотеть уведомлений, и приложение продолжает работать.
 * Поэтому здесь нет ни повторных запросов, ни диалогов поверх интерфейса.
 *
 * Переход по уведомлению обрабатывать здесь не нужно: интент приходит с `ACTION_VIEW` и адресом
 * статьи, а Capacitor сам отдаёт его странице событием `appUrlOpen` (см. `NativeShell` на сайте).
 */
public class MainActivity extends BridgeActivity {

    /** Произвольный код запроса; важен лишь тем, что отличает ответ от других запросов. */
    private static final int NOTIFICATIONS_REQUEST = 101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        askForNotificationPermission();
    }

    /**
     * Создаёт канал «Срочные новости» до того, как придёт первое уведомление.
     *
     * Это не то же самое, что создать канал при показе: уведомление рисует не только наша служба,
     * но и сам SDK RuStore — когда пуш приходит с готовым объектом `notification` (так устроен, в
     * частности, тестовый пуш из консоли RuStore). SDK берёт идентификатор канала из манифеста и
     * в несуществующий канал отправить не может: Android отбрасывает такое уведомление молча,
     * без ошибки в логе приложения. На свежей установке, где служба ещё ни разу не сработала,
     * тестовый пуш пропал бы именно так.
     */
    private void createNotificationChannel() {
        PushNotifications.ensureChannel(this);
    }

    private void askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;

        boolean granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
        if (granted) return;

        ActivityCompat.requestPermissions(
            this,
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            NOTIFICATIONS_REQUEST
        );
    }
}

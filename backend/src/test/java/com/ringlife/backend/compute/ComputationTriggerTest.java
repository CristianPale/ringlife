package com.ringlife.backend.compute;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import com.ringlife.backend.alert.AlertService;
import com.ringlife.backend.ha.HaPublisher;
import com.ringlife.backend.plugin.PluginService;

/** When alerts are evaluated (ADR 0045): after the daily computation and the plugins, before Home Assistant. */
class ComputationTriggerTest {

    private final DailyComputationService service = mock(DailyComputationService.class);
    private final HaPublisher publisher = mock(HaPublisher.class);
    private final PluginService plugins = mock(PluginService.class);
    private final AlertService alerts = mock(AlertService.class);
    private final ComputationTrigger trigger = new ComputationTrigger(service, publisher, plugins, alerts);

    @Test
    void afterAnUploadTheAlertsRunOnTheRecomputedDaysAfterThePlugins() {
        LocalDate day = LocalDate.of(2026, 11, 12);
        when(service.dayOf(1_000L)).thenReturn(day);
        trigger.afterIngest("dev", 1_000L);
        InOrder order = inOrder(service, plugins, alerts, publisher);
        order.verify(service).recomputeFrom("dev", day);
        order.verify(plugins).evaluateAll("dev");
        order.verify(alerts).evaluateFrom("dev", day);
        order.verify(publisher).publish("dev");
    }

    @Test
    void everyNightTheAlertsRunOnTheSameDaysAsTheComputation() {
        trigger.nightly();
        InOrder order = inOrder(service, plugins, alerts, publisher);
        order.verify(service).recomputeRecent(ComputationTrigger.NIGHTLY_DAYS);
        order.verify(plugins).evaluateEveryDevice();
        order.verify(alerts).evaluateRecent(ComputationTrigger.NIGHTLY_DAYS);
        order.verify(publisher).publishLatestDevice();
    }

    @Test
    void aFailingComputationNeverFailsTheUpload() {
        when(service.dayOf(1_000L)).thenReturn(LocalDate.of(2026, 11, 12));
        doThrow(new IllegalStateException("boom")).when(service).recomputeFrom("dev", LocalDate.of(2026, 11, 12));
        trigger.afterIngest("dev", 1_000L);
        verify(service).recomputeFrom("dev", LocalDate.of(2026, 11, 12));
    }
}

package com.ringlife.backend.ingest;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ringlife.backend.compute.ComputationTrigger;
import com.ringlife.backend.ingest.IngestDtos.Result;
import com.ringlife.backend.ingest.IngestDtos.SamplesRequest;
import com.ringlife.backend.ingest.IngestDtos.SleepRequest;

/** Caricamento dei dati grezzi dal telefono. L'autenticazione e' nell'interceptor del dispositivo. */
@RestController
@RequestMapping("/api/v1/devices/{deviceId}")
class IngestController {

    private final IngestService service;
    private final IngestValidator validator;

    private final ComputationTrigger trigger;

    IngestController(IngestService service, IngestValidator validator, ComputationTrigger trigger) {
        this.service = service;
        this.validator = validator;
        this.trigger = trigger;
    }

    @PostMapping("/samples")
    Result samples(@PathVariable String deviceId, @RequestBody SamplesRequest request) {
        int offset = validator.offset(request.tzOffsetMin());
        validator.samples(request.samples());
        Result result = service.ingestSamples(deviceId, offset, request.samples());
        request.samples().stream().mapToLong(IngestDtos.Sample::ts).min().ifPresent(ts -> trigger.afterIngest(deviceId, ts));
        return result;
    }

    @PostMapping("/sleep")
    Result sleep(@PathVariable String deviceId, @RequestBody SleepRequest request) {
        int offset = validator.offset(request.tzOffsetMin());
        validator.sessions(request.sessions());
        Result result = service.ingestSleep(deviceId, offset, request.sessions());
        request.sessions().stream().mapToLong(IngestDtos.Session::start).min().ifPresent(ts -> trigger.afterIngest(deviceId, ts));
        return result;
    }
}

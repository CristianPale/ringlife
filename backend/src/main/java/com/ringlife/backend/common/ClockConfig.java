package com.ringlife.backend.common;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Orologio iniettabile: i test lo sostituiscono con uno fisso. */
@Configuration
class ClockConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}

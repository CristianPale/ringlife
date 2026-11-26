package com.ringlife.backend.device;

import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DeviceService {

    private final JdbcTemplate jdbc;
    private final TokenService tokens;

    public DeviceService(JdbcTemplate jdbc, TokenService tokens) {
        this.jdbc = jdbc;
        this.tokens = tokens;
    }

    public record Registration(String deviceId, String token) {}

    /** Registra un dispositivo, o lo riconosce dall'identificativo hardware. Ogni volta emette un token nuovo. */
    @Transactional
    public Registration register(String hardwareId, String model, String firmware) {
        String id = jdbc.query("SELECT id FROM device WHERE mac = ?", (rs, i) -> rs.getString(1), hardwareId)
                .stream()
                .findFirst()
                .orElse(null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO device (id, mac, model, firmware) VALUES (?, ?, ?, ?)", id, hardwareId, model, firmware);
        } else {
            jdbc.update("UPDATE device SET model = ?, firmware = ? WHERE id = ?", model, firmware, id);
        }
        return new Registration(id, tokens.issue(id));
    }
}

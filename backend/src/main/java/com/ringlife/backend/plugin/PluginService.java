package com.ringlife.backend.plugin;

import java.time.Clock;
import java.time.ZoneId;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.ringlife.backend.common.ApiException;
import com.ringlife.backend.compute.DailyComputationService;
import com.ringlife.backend.compute.ComputeSettings;
import com.ringlife.backend.compute.History;
import com.ringlife.backend.diary.DiaryLog;
import com.ringlife.backend.weather.PressureHistory;
import com.ringlife.backend.weather.UvHistory;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Registro e valutazione dei plugin (ADR 0013). Ogni plugin e' isolato: un errore in uno registra solo il tipo
 * dell'errore, lascia il suo risultato precedente e non tocca gli altri. Mai un valore di salute nei log.
 */
@Service
public class PluginService {

    private static final Logger LOG = LoggerFactory.getLogger(PluginService.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    /** Un plugin per l'app: manifest, stato, configurazione completa e il risultato del giorno (null se non c'e'). */
    public record PluginView(PluginManifest manifest, boolean enabled, Map<String, Object> config, JsonNode result) {}

    private final Map<String, Plugin> plugins = new LinkedHashMap<>();
    private final PluginRepository repository;
    private final History history;
    private final DiaryLog diary;
    private final PressureHistory pressure;
    private final UvHistory uv;
    private final ComputeSettings settings;
    private final DailyComputationService computation;
    private final Clock clock;
    private final ObjectMapper json;

    PluginService(
            List<Plugin> registered,
            PluginRepository repository,
            History history,
            DiaryLog diary,
            PressureHistory pressure,
            UvHistory uv,
            ComputeSettings settings,
            DailyComputationService computation,
            Clock clock,
            ObjectMapper json) {
        Set<String> seen = new HashSet<>();
        for (Plugin plugin : registered) {
            if (!plugin.id().equals(plugin.manifest().id()) || !seen.add(plugin.id())) {
                throw new IllegalStateException("Plugin con identificativo duplicato o incoerente");
            }
            plugins.put(plugin.id(), plugin);
        }
        this.repository = repository;
        this.history = history;
        this.diary = diary;
        this.pressure = pressure;
        this.uv = uv;
        this.settings = settings;
        this.computation = computation;
        this.clock = clock;
        this.json = json;
    }

    /** Valuta per oggi i plugin accesi di un dispositivo. Non lancia mai. */
    public void evaluateAll(String deviceId) {
        LocalDate today = computation.today();
        for (Plugin plugin : plugins.values()) {
            evaluate(deviceId, plugin, today);
        }
    }

    /** Valuta per oggi i plugin accesi di tutti i dispositivi (job notturno). */
    public void evaluateEveryDevice() {
        for (String deviceId : repository.deviceIds()) {
            evaluateAll(deviceId);
        }
    }

    /** Tutti i plugin registrati, con il risultato del giorno (oggi se `day` e' null). */
    public List<PluginView> list(String deviceId, LocalDate day) {
        LocalDate date = day == null ? computation.today() : day;
        return plugins.values().stream().map(plugin -> view(deviceId, plugin, date)).toList();
    }

    /**
     * Accende, spegne o configura un plugin. `enabled` e `config` assenti restano come sono. La configurazione e'
     * validata contro il manifest (400). Un plugin acceso si rivaluta subito.
     */
    public PluginView update(String deviceId, String pluginId, Boolean enabled, Map<String, Object> config) {
        Plugin plugin = plugins.get(pluginId);
        if (plugin == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Plugin sconosciuto");
        }
        if (config != null) {
            plugin.manifest().complete(config);
        }
        PluginRepository.State current = repository.state(deviceId, pluginId).orElse(null);
        boolean nextEnabled = enabled != null ? enabled : current == null || current.enabled();
        Map<String, Object> nextConfig = config != null ? config : chosen(current);
        repository.saveState(deviceId, pluginId, nextEnabled, json.writeValueAsString(nextConfig), clock.millis());
        LocalDate today = computation.today();
        if (nextEnabled) {
            evaluate(deviceId, plugin, today);
        }
        return view(deviceId, plugin, today);
    }

    /** Le entita' di Home Assistant dichiarate dai plugin registrati, nell'ordine dei plugin. */
    public List<PluginManifest.EntityDef> entityDefinitions() {
        return plugins.values().stream().flatMap(plugin -> plugin.manifest().entities().stream()).toList();
    }

    /**
     * Gli stati di oggi delle entita' dei plugin accesi di un dispositivo, per chiave. Un plugin spento o senza
     * risultato non compare: la sua entita' resta «sconosciuta».
     */
    public Map<String, PluginResult.EntityState> entityStates(String deviceId) {
        Map<String, PluginResult.EntityState> states = new LinkedHashMap<>();
        String today = computation.today().toString();
        for (Plugin plugin : plugins.values()) {
            if (plugin.manifest().entities().isEmpty()) {
                continue;
            }
            PluginRepository.State state = repository.state(deviceId, plugin.id()).orElse(null);
            if (state != null && !state.enabled()) {
                continue;
            }
            repository.result(deviceId, plugin.id(), today, plugin.manifest().version()).ifPresent(payload -> {
                for (JsonNode entity : json.readTree(payload).path("entities")) {
                    String key = entity.path("key").asString();
                    String value = entity.path("state").isNull() ? null : entity.path("state").asString();
                    Map<String, Object> attributes = json.convertValue(entity.path("attributes"), MAP);
                    states.put(key, new PluginResult.EntityState(key, value, attributes));
                }
            });
        }
        return states;
    }

    /**
     * The alerts in the stored result of a day of one plugin (ADR 0045). Empty when the plugin is unknown or off for the
     * device, when the day has no result, and for results stored before alerts existed; a malformed alert is skipped.
     */
    public List<PluginResult.Alert> alerts(String deviceId, String pluginId, LocalDate day) {
        Plugin plugin = plugins.get(pluginId);
        if (plugin == null) {
            return List.of();
        }
        PluginRepository.State state = repository.state(deviceId, pluginId).orElse(null);
        if (state != null && !state.enabled()) {
            return List.of();
        }
        List<PluginResult.Alert> raised = new java.util.ArrayList<>();
        repository.result(deviceId, pluginId, day.toString(), plugin.manifest().version()).ifPresent(payload -> {
            for (JsonNode node : json.readTree(payload).path("alerts")) {
                try {
                    Map<String, Object> values = node.path("values").isObject() ? json.convertValue(node.path("values"), MAP) : Map.of();
                    raised.add(new PluginResult.Alert(
                            node.path("rule").asString(""), node.path("title").asString(""), node.path("body").asString(""), values));
                } catch (RuntimeException e) {
                    LOG.warn("Avviso del plugin {} non valido: ignorato", pluginId);
                }
            }
        });
        return raised;
    }

    private ZoneId zone() {
        return settings.zone();
    }

    private PluginView view(String deviceId, Plugin plugin, LocalDate day) {
        PluginRepository.State state = repository.state(deviceId, plugin.id()).orElse(null);
        boolean enabled = state == null || state.enabled();
        Map<String, Object> config = plugin.manifest().complete(chosen(state));
        JsonNode result = enabled
                ? repository.result(deviceId, plugin.id(), day.toString(), plugin.manifest().version())
                        .map(json::readTree).orElse(null)
                : null;
        return new PluginView(plugin.manifest(), enabled, config, result);
    }

    private void evaluate(String deviceId, Plugin plugin, LocalDate day) {
        try {
            PluginRepository.State state = repository.state(deviceId, plugin.id()).orElse(null);
            if (state != null && !state.enabled()) {
                return;
            }
            PluginContext context = contextFor(deviceId, plugin, state, day);
            PluginResult result = plugin.evaluate(context, day);
            repository.saveResult(
                    deviceId, plugin.id(), day.toString(), plugin.manifest().version(), json.writeValueAsString(result), clock.millis());
        } catch (RuntimeException e) {
            // Solo il tipo dell'errore: il messaggio potrebbe contenere valori.
            LOG.warn("Plugin {} fallito: {}", plugin.id(), e.getClass().getSimpleName());
        }
    }

    /** Il contesto di un plugin per un dispositivo, con la sua configurazione completata. Serve anche al report al medico. */
    PluginContext contextFor(String deviceId, String pluginId, LocalDate day) {
        Plugin plugin = plugins.get(pluginId);
        if (plugin == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Plugin sconosciuto");
        }
        return contextFor(deviceId, plugin, repository.state(deviceId, pluginId).orElse(null), day);
    }

    private PluginContext contextFor(String deviceId, Plugin plugin, PluginRepository.State state, LocalDate day) {
        return new PluginContext(
                deviceId, day, clock.instant(), zone(), plugin.manifest().complete(chosen(state)), history, diary, pressure, uv);
    }

    private Map<String, Object> chosen(PluginRepository.State state) {
        if (state == null) {
            return Map.of();
        }
        try {
            return json.readValue(state.config(), MAP);
        } catch (RuntimeException e) {
            return Map.of();
        }
    }
}

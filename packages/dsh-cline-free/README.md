# dsh-cline-free

Cline Free-Modelle in **DSH Desktop** (DeepSeek Harness Desktop) nutzen — mit den
Produkt-Headern, die Cline für diese Modell-IDs verlangt, und mit **eigenen
Einstellungen pro Modell** (Kontext, max. Ausgabe, Vision, Reasoning).

> **Status:** Die Logik ist durch 53 automatisierte Tests gegen eine echte
> `LlmRuntime` und einen lokalen Mock-Server geprüft (`npm test`). Die
> Installation selbst konnte **nicht** auf einem Windows-Rechner mit DSH Desktop
> ausgeführt werden — siehe [§10 Grenzen](#10-grenzen-stand-der-prüfung).

---

## 1. Was das Plugin tut

| | |
|---|---|
| Registriert beim LLM-Registry | Provider `cline-free` („Cline Free“) |
| Modellen | Die **aktuelle** Gratisliste von Cline, live von `api.cline.bot` |
| Einstellungen pro Modell | Kontextfenster, max. Ausgabe-Tokens, Vision (Bild/PDF), Reasoning-Stufen — je Modell einzeln aus dem Cline-Katalog |
| Authentifizierung | Cline-WorkOS-Session (`Bearer workos:<jwt>`), Cline-API-Key (`sk_…`) oder Refresh-Token |
| Oberfläche | Karte unter **Einstellungen → Plugins → Cline Free** |
| Streaming | Server-Sent Events, inkl. Reasoning-Deltas und Tool-Calls |

Nach der Installation erscheinen die Modelle im normalen Modellwähler von DSH
Desktop wie jede andere Route auch.

---

## 2. Warum andere Harnesses daran scheitern

Cline bietet zwei völlig verschiedene Dinge an, die leicht verwechselt werden:

1. **Die Cline API** (`api.cline.bot`, OpenAI-kompatibel) — offiziell
   dokumentiert, mit eigenem API-Key nutzbar. **Die Gratismodelle sind hier
   ausdrücklich nicht enthalten** ([Cline-Doku](https://docs.cline.bot/getting-started/free-models)).
2. **Die Gratismodelle** — nur innerhalb der Cline-Erweiterung bzw. CLI.

Das Gateway prüft die **Produktidentität** des Absenders. Fehlen die Cline-Header,
antwortet es auf die Gratis-Modell-IDs mit **HTTP 403**, auch wenn der Token
vollkommen gültig ist. Genau das ist der Fehler, den andere Agents und Harnesses
melden: sie senden einen korrekten Token — nur eben ohne die Cline-Header.

Dieses Plugin sendet bei jedem Request:

```http
Authorization:  Bearer workos:<jwt>
X-Title:        Cline
X-Client-Type:  VSCode Extension
X-Client-Version: 4.1.23
X-Core-Version: 0.0.92
X-Platform:     Visual Studio Code
X-Platform-Version: 1.141.0
HTTP-Referer:   https://cline.bot
User-Agent:     Cline/4.1.23
x-dsh-client:   deepseek-harness/…      ← zusätzlich: Harness-Attribution
```

Zusätzlich gilt: ein OAuth-Zugriffstoken (JWT) **muss** als `Bearer workos:<jwt>`
gesendet werden; Cline-API-Keys (`sk_…`) **dürfen** dieses Präfix nicht erhalten.
Das Plugin erkennt den Typs selbstständig.

---

## 3. Voraussetzungen

- **Windows** mit einer aktuellen DSH-Desktop-Version (der Harness-Plugin-Mechanismus
  ab `0.1.x`), Node wird vom Desktop selbst mitgebracht.
- Ein **Cline-Konto** (kostenlos) — für die Gratismodelle zwingend, weil das
  Gateway die Modelle dem Konto zuordnet.
- Für den komfortabelsten Weg: die **Cline CLI** oder die **Cline-VS-Code-Erweiterung**
  (beide bringen ein brauchbares Token mit; s. §5).

---

## 4. Installation unter Windows

### 4.1 Paket bauen

```bat
cd packages\dsh-cline-free
npm install
npm test          % optional: 53 Tests
npm pack
```

Ergebnis: `dsh-cline-free-1.0.0.tgz`.

### 4.2 Zuerst prüfen, was **Ihre** Desktop-Version kann

Die DSH-Doku verlangt ausdrücklich, die Installationsfähigkeit an der
tatsächlichen Version zu prüfen und nicht aus einer Versionsnummer zu raten:

1. In DSH Desktop **Über / About** öffnen → Version, Plattform und Architektur notieren.
2. Unter **Arbeitsflächen-Verwaltung → Installierte Arbeitsflächen** (bzw. der
   entsprechenden Plugin-Verwaltung) nach einer Möglichkeit suchen, ein **lokales
   Paket** oder eine `.tgz`-Datei zu installieren.
3. Falls es eine CLI gibt: `dsh plugin add --help` aufrufen und prüfen, ob ein
   lokaler Pfad/`.tgz` akzeptiert wird.

Nur einen Weg benutzen, den die Oberfläche oder `--help` **explizit** anbietet.

### 4.3 Weg A — über die CLI (wenn unterstützt)

```bat
dsh plugin add "C:\Pfad\zu\dsh-cline-free-1.0.0.tgz"
```

Danach den von Desktop verlangten **Neustart** durchführen.

### 4.4 Weg B — über die Installations-Oberfläche

Falls Ihre Version einen Datei-Dialog für lokale Pakete anbietet: das `.tgz`
dort auswählen, installieren, neu starten.

### 4.5 Weg C — von Hand (nur wenn A und B nicht verfügbar sind)

Der Desktop lädt die Harness-Profile aus seinem `DSH_HOME`, auf Windows unter
`%APPDATA%\<App-Ordner>\harness`. Der genaue Ordnername hängt von Ihrer
Installation ab — suchen Sie den Ordner `harness`, der `profiles\web` enthält.

1. DSH Desktop **vollständig beenden**.
2. `<DSH_HOME>\profiles\web\node_modules\dsh-cline-free\` anlegen und den Inhalt
   des `.tgz` dorthin entpacken (`package.json` muss direkt in diesem Ordner liegen).
3. In `<DSH_HOME>\profiles\web\package.json` unter `dependencies` eintragen:
   `"dsh-cline-free": "1.0.0"`.
4. In `<DSH_HOME>\profiles\web\cordis.patch.yml` ergänzen:

   ```yaml
   - insert:
       - id: dsh-cline-free
         name: dsh-cline-free
         config:
           providers:
             cline-free:
               displayName: Cline Free
               apiKeyEnv: CLINE_FREE_API_KEY
               baseURL: https://api.cline.bot/api/v1
   ```

5. DSH Desktop neu starten.

> Vor Änderungen an `profiles\web\` eine Kopie anlegen.

### 4.6 Kontrolle nach dem Neustart

- **Einstellungen → Plugins**: dort muss die Karte **Cline Free** auftauchen.
- `dsh --profile web --dump-config` zeigt einen Eintrag `dsh-cline-free` — das
  beweist die **Konfiguration**, nicht dass die Oberfläche geladen wurde.
- Modellwähler: der Provider **Cline Free** erscheint erst, sobald ein Token
  hinterlegt ist (die Modelle werden live geladen).

---

## 5. Cline-Token beschaffen

Öffnen Sie **Einstellungen → Plugins → Cline Free** und wählen einen der Wege.

### Weg 1 — CLI-Login übernehmen (empfohlen)

Wenn die Cline CLI auf diesem Rechner schon eingeloggt ist, zeigt die Karte
automatisch den Button **„Cline-CLI-Anmeldung dieses Rechners übernehmen“**
(samt erkannter E-Mail). Ein Klick genügt — kein Browser, kein Kopieren.

Gelesen werden u. a. `%USERPROFILE%\.cline\data\settings\providers.json` und
`%USERPROFILE%\.cline\settings\providers.json` (bzw. `$CLINE_DIR`, falls gesetzt).

### Weg 2 — Token aus der Cline-Erweiterung / CLI kopieren

In das Feld einfügen, eines von:

| Eingabe | Beispiel |
|---|---|
| Zugriffstoken (JWT) | `eyJhbGciOiJSUzI1NiJ9.…` |
| … mit Präfix | `workos:eyJhbGciOiJSUzI1NiJ9.…` |
| Vollständiges Bundle (JSON) | `{"accessToken":"eyJ…","refreshToken":"…","expiresAt":…}` |
| Nur Refresh-Token | `refresh: <token>` |
| Cline-API-Key | `sk_…` |

Das Bundle ist die beste Wahl: es enthält den Refresh-Token, mit dem das Plugin
die Session **automatisch verlängert** (5 Minuten vor Ablauf).

### Weg 3 — Umgebungsvariable

`CLINE_FREE_TOKEN` oder `CLINE_FREE_API_KEY` setzen. Nützlich für headless/CI;
die Karte zeigt dann „verbunden“, ohne dass etwas gespeichert wird.

> Der gespeicherte Token wird **nie** zurück an die Oberfläche geschickt. Vor dem
> Speichern wird er gegen `api.cline.bot/api/v1/users/me` geprüft; lehnt Cline
> ihn ab, wird nichts gespeichert.

---

## 6. Benutzung

1. Token speichern (§5).
2. Karte öffnen → **„Modellliste aktualisieren“** (oder warten, der erste Start
   lädt sie automatisch).
3. Im Modellwähler von DSH Desktop den Provider **Cline Free** aufklappen und ein
   Modell wählen.

Die Karte zeigt danach eine Tabelle mit den **tatsächlich aufgelösten** Werten:
Modell, Kontext, max. Ausgabe, Vision, Reasoning-Stufen — plus die Quelle
(`live`, `zwischengespeichert` oder `eingebaute Notliste`) und den Zeitpunkt.
**„Testnachricht senden“** schickt eine kurze Nachricht an das erste Modell und
zeigt die Antwort — der schnellste Weg zu prüfen, ob Token *und* Header greifen.

---

## 7. Einstellungen pro Modell

Kein gemeinsames Profil — jedes Modell bekommt seine eigenen Werte aus dem
öffentlichen Cline-Katalog (`GET /api/v1/ai/cline/models`):

| Harness-Feld | Quelle im Katalog |
|---|---|
| Kontextfenster | `top_provider.context_length` → sonst `context_length` → 200 000 |
| Max. Ausgabe | `top_provider.max_completion_tokens` → `max_completion_tokens`, **begrenzt** auf das Kontextfenster |
| Vision (Bild/PDF) | `architecture.input_modalities` enthält `image` bzw. `file` |
| Reasoning-Stufen | `supported_parameters` enthält `reasoning` / `reasoning_effort` → `low`/`medium`/`high` |

Was das im Betrieb bedeutet:

- **Bilder** werden nur an Modelle gesendet, die sie auch verstehen; bei einem
  Text-Modell wird der Bildteil weggelassen statt einen Fehler zu produzieren.
  Bilder werden über den Harness-Anhang-Dienst (`ctx.attachments`) aufgelöst,
  verkleinert und als Base64-Data-URI gesendet — Standard-Obergrenze 4 MB,
  konfigurierbar über `imageMaxBytes`.
- **Reasoning**: eine Stufe, die das Modell nicht anbietet, wird **vor** dem
  Request abgelehnt, statt sie zu senden und einen Gateway-Fehler zu riskieren.
- **Max. Ausgabe** ist standardmäßig die Obergrenze des Modells, nie mehr.
- Modelle, die in der Live-Liste stehen, aber nicht im Katalog, laufen mit
  200 000 / 32 000 als konservativen Standardwerten.

**Die Gratisliste wechselt regelmäßig.** Zuletzt gesehen (Stand 26.10.2026):

- `reflection/beam-free` — Beam
- `cline-free/nemotron-3.5-super-vl` — Nemotron 3.5 Super VL
- `nvidia/nemotron-3.5-lightning-free` — Nemotron 3.5 Lightning
- `poolside/laguna-s-2.1-free` — Laguna S 2.1
- `cline-free/solar-mini4` — Solar Mini 4

Maßgeblich ist immer die Liste in Ihrer Karte, nicht diese Aufzählung. Für nicht
gelistete IDs gilt: sie werden durchgereicht, funktionieren aber nur, wenn Ihr
Cline-Konto sie freischaltet.

---

## 8. Konfiguration

Optional im Plugin-Eintrag (`config:` in `cordis.patch.yml`):

| Feld | Standard | Bedeutung |
|---|---|---|
| `root` | DSH-Datenverzeichnis | Wo der Modell-Cache (`cline-free-models.json`) liegt |
| `baseURL` | `https://api.cline.bot/api/v1` | Gateway-Endpunkt |
| `identity` | `true` | Cline-Produkt-Header senden. **Nie ohne Grund abschalten** — genau dann kommt der 403 |
| `headers` | `{}` | Zusätzliche Header; überschreiben `identity` gleichnamiger Header |
| `imageMaxBytes` | `4194304` | Obergrenze pro Bild |
| `retryPolicy` | `{ maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 4000 }` | Wiederholungen bei vorübergehenden Fehlern (429/5xx) |

Endpunkte, die das Plugin benutzt:

| Zweck | Endpunkt |
|---|---|
| Gratisliste | `GET /api/v1/ai/cline/recommended-models` |
| Katalog | `GET /api/v1/ai/cline/models` |
| Chat | `POST /api/v1/chat/completions` (SSE) |
| Tokenprüfung | `GET /api/v1/users/me` |
| Verlängerung | `POST /api/v1/auth/refresh` |

Die Karte ist über `/api/cline-free.{settings,refresh,token,import,logout,test}`
angebunden; alle Routen werden beim Deaktivieren des Plugins restlos abgemeldet.

**Abhängigkeiten:** `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-credentials` und
`@deepseek-ai/schemastery` sind absichtlich *optionale* Peer-Abhängigkeiten. Der
Host stellt sie bereits; würde der Installer stattdessen eine zweite Kopie neben
das Plugin legen, käme `LlmAdapter` aus einer anderen Modul-Instanz als `ctx.llm`
und jeder Adapter würde abgelehnt. Bitte so belassen.

---

## 9. Fehlerbehebung

| Meldung | Ursache / Abhilfe |
|---|---|
| **403** | Produktidentität fehlt. `identity` darf nicht `false` sein; eigene `headers` dürfen `user-agent`/`x-title` nicht überschreiben. |
| **401 / „Token abgelaufen“** | Abgelaufene Session ohne Refresh-Token → Token mit Bundle (refresh-Token) erneut speichern. |
| **„Noch kein Token gespeichert“** | §5. |
| **„Der Zugangsspeicher ist schreibgeschützt“** | Die Umgebungsvariable (Weg 3) nutzen. |
| **„Cline hat den Token abgelehnt“** | Token gehört nicht zum Cline-Gateway (z. B. ein reiner OpenRouter-Key) oder ist abgelaufen. |
| **Modellliste leer** | „Modellliste aktualisieren“; ohne Netzwerk greift die eingebaute Notliste. |
| **Bild wird ignoriert** | Modell ohne Bild-Unterstützung, oder Bild über `imageMaxBytes`. |
| **Reasoning wird abgelehnt** | Das Modell bietet diese Stufe nicht; die Karte zeigt, welche es anbietet. |
| **Provider fehlt im Modellwähler** | Erst nach dem Neustart (§4.6) und mit gültigem Token sichtbar. |

---

## 10. Grenzen, Stand der Prüfung

**Geprüft** (53 Tests, `npm test`, Node 22, Linux):

- Anmeldung am LLM-Registry als `{id:'cline-free', name:'Cline Free'}` sowie die
  Meldung als konfigurierbarer Provider mit Settings-Adresse.
- Pro-Modell-Auflösung von Kontext, Ausgabe, Modalitäten und Reasoning-Stufen;
  Ablehnung nicht unterstützter Reasoning-Stufen vor jedem Request.
- Cline-Identitätsheader neben der Harness-Attribution; `Bearer workos:<jwt>`;
  `x-task-id` je Sitzung.
- Vollständige SSE-Chunk-Folge inkl. Reasoning- und Tool-Call-Deltas, Nutzungsdaten
  und Abschlussgrund; Werkzeugaufruf → Werkzeugergebnis-Rückweg.
- Bilder nur an Bild-Modelle; Text-Modelle erhalten keinen `image_url`.
- Fehlerabbildung: 403 → `AUTH`, 429 → `RATE_LIMIT`, leerer Strom →
  `EMPTY_RESPONSE`, fehlender Token → `MISSING_CREDENTIAL` **ohne** jeden Request.
- Tokenverwaltung: Speichern mit Vorabprüfung, automatische Verlängerung
  (einmalig, single-flight), Spiegelung des Tokens in die Referenz, die andere
  Oberflächen lesen, Abmelden, CLI-Import.
- Katalogquellen in der Reihenfolge live → Cache → Notliste.

**Nicht geprüft:**

- Die Installation in einer echten Windows-DSH-Desktop-Version. Es wurde keine
  Windows-Maschine und keine Desktop-Instanz verwendet; die Wege in §4 sind aus
  der DSH-Dokumentation abgeleitet, nicht ausgeführt.
- Die Einstellungs-Oberfläche im Browser (`client.js`). Deren Aufhängung
  (`ctx.locale.register/bind`, `ctx.slots.inject('settings.plugins.tab')`) folgt
  dem veröffentlichten Vertrag, wurde aber nicht in einer laufenden Oberfläche
  ausgeführt.
- `tools/cline-login.mjs` (Hilfsskript für einen WorkOS-Device-Flow) wurde nie
  gegen Cline ausgeführt.

**Bitte beachten:** Die Gratismodelle sind nach Cline-Doku für die Nutzung
**innerhalb von Cline** gedacht. Dieses Plugin macht dieselben Requests wie die
Cline-Erweiterung; ob das in Ihrem Fall den Cline-Nutzungsbedingungen entspricht,
liegt in Ihrer Verantwortung. Nutzungs- und Kontingentgrenzen setzt Cline
kontoseitig, nicht dieses Plugin.

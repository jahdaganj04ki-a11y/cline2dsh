# cline2dsh

Bringt die **Gratismodelle von Cline** in **DSH Desktop** (DeepSeek Harness
Desktop) — als Harness-Plugin, das die Cline-Produktidentität mitsendet, die das
Gateway für diese Modell-IDs verlangt, und das jedem Modell seine eigenen
Einstellungen gibt (Kontext, max. Ausgabe, Vision, Reasoning).

## Paket

| Pfad | Inhalt |
|---|---|
| [`packages/dsh-cline-free`](packages/dsh-cline-free) | Das Plugin. **[README mit Anleitung (deutsch)](packages/dsh-cline-free/README.md)** |

## Kurzform

```bat
cd packages\dsh-cline-free
npm install
npm pack          % -> dsh-cline-free-1.0.0.tgz
```

Das `.tgz` in DSH Desktop installieren (CLI bzw. lokale Paketinstallation, je
nachdem, was Ihre Version unterstützt), neu starten, unter
**Einstellungen → Plugins → Cline Free** den Cline-Token hinterlegen und im
Modellwähler den Provider **Cline Free** wählen.

## Warum ein Plugin nötig ist

Cline liefert die Gratismodelle nur an Anfragen aus, die wie Cline aussehen:
`X-Title: Cline`, `User-Agent: Cline/4.1.23`, `X-Client-Type: VSCode Extension`
usw. Fehlen diese Header, antwortet das Gateway mit **403** — genau der Fehler,
den andere Agents und Harnesses melden. Der Token ist dabei meist völlig in
Ordnung; es fehlt die Identität. Details in Abschnitt 2 des Paket-READMEs.

## Stand

Logik durch 53 automatisierte Tests geprüft; die Installation unter Windows mit
echter DSH-Desktop-Version ist **nicht** ausgeführt worden — siehe Abschnitt 10
des Paket-READMEs.

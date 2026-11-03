# Agenten und PDFs

Die App arbeitet mit deinen Claude-Agenten zusammen und erzeugt Standard-PDFs selbst.

## Überblick

| Was | Wo | Wie |
|---|---|---|
| Schnitt, Endkontrolle, Highlight-Reel | Agent `videoschnitt` in Claude | nutzt deine Skills Clip-Qualitätsprüfung und Local Highlight Reel |
| Individuelle PDFs (Angebot, Konzept, Content-Plan, Formulare) | Agent `pdf-erstellung` in Claude | nutzt den Skill PDF mit Daten aus der App |
| Monatsbericht, Drehplan, Freigabe-Protokoll, Briefing | direkt in der App | ein Klick, ohne Claude |

Die Agenten liegen im App-Ordner unter `.claude/agents/`. Sie enthalten nur die Arbeitsanweisung und verweisen auf deine Skills. Deine Prüfskripte, Kundenprofile und Kalibrierungen bleiben in deinen Skills und kommen nicht ins Repository.

---

## Videoschnitt mit Claude

### Einmalig einrichten

1. **Google Drive für den Desktop** installieren (<https://www.google.com/drive/download/>) und mit deinem Workspace-Konto anmelden. Dann liegen die Drive-Ordner auf dem Mac unter `~/Library/CloudStorage/GoogleDrive-…/Meine Ablage`, und der Agent kommt direkt an Rohmaterial und „Fertige Videos“. Für große Rohdaten in den Einstellungen von Google Drive „Dateien streamen“ wählen.
2. **Werkzeuge für die Prüfskripte**: ffmpeg (mit vidstab), Python 3, numpy und OpenCV. Beim ersten Auftrag prüft der Agent das und fragt vor jeder Installation nach. Von Hand im Terminal:
   ```
   brew install ffmpeg
   python3 -m pip install --user numpy opencv-python-headless
   ```
   (Homebrew vorher von <https://brew.sh> installieren, falls noch nicht vorhanden.)
3. **Prüfprofil je Kunde**: Kunde bearbeiten > Abschnitt „Videoschnitt“. „Automatisch“ leitet das Profil aus dem Kundentyp ab (Restaurant, Handwerk, Arztpraxis = strenges Praxisprofil, Fahrschule, sonst Standard). Dort auch „Durchgehende Kamerabewegung Pflicht“ und Hinweise wie „keine Hände im Bild“ oder „Endschnitt in Premiere“ eintragen. Steht der Kunde bereits in der Kundentabelle deines Skills und ist in der App nichts festgelegt, gilt die Einstellung aus dem Skill.

### Einen Auftrag starten

1. Projekt öffnen, Phase **Bearbeitung** (oder Upload).
2. Im Bereich „Videoschnitt mit Claude“ wählen:
   - **Schnitt und Endkontrolle**: Rohmaterial prüfen, schneiden, Endkontrolle, Lieferung in „Fertige Videos“.
   - **Nur Endkontrolle**: die fertigen Videos im Ordner prüfen, ohne neu zu schneiden.
   - **Highlight-Reel** mit Wunschlänge in Sekunden: erst Clip-Prüfung, dann Kurzschnitt aus dem geprüften Material, danach Endkontrolle.
3. **Kopieren** klicken.
4. Claude Desktop öffnen, Bereich **Code**, Ordner **agentur-app** wählen, einfügen, senden. Die App muss dabei laufen (`npm start`).

Der Auftrag enthält Projektnummer, Kunde, Ziel, Prüfprofil und das Kundenfeedback der letzten Korrekturschleife. Alles Weitere holt sich der Agent aus der App.

### Was danach in der App passiert

- Der Agent meldet jede Endkontrolle an die App. Die Ergebnisse stehen im Projekt unter „Videoschnitt mit Claude“: bestanden oder zurück, mit Zeitcodes der Fehler.
- Sind **alle** Videos des Projekts bestanden, und zwar so viele, wie im Projekt vorgesehen sind (bei „4 × Reel“ also vier), hakt die App „Clip-Qualitätsprüfung abgeschlossen“ automatisch ab. Vorher meldet sie zum Beispiel „1 von 4 Videos bestanden“. Das Projekt kann dann weiter in den Upload. Ein späteres „zurück“ nimmt den Haken wieder weg. Sollen es weniger Videos werden, den Haken von Hand setzen oder die Anzahl im Projekt anpassen.
- Fassungen desselben Videos (`reel_01_v2.mp4`, `reel_01_v3.mp4`) zählt die App als ein Video; die jüngste Endkontrolle gilt.
- Legt der Agent die Videos in „Fertige Videos“, erkennt die App sie dort und hakt auch „Dateien im Ordner Fertige Videos“ ab.
- Benachrichtigungen (Glocke links unten) melden bestandene und zurückgewiesene Endkontrollen.
- Ein falsch gemeldetes Ergebnis lässt sich im Projekt entfernen (Papierkorb beim Darüberfahren).

### Nach Kundenfeedback

Im Projekt in der Freigabe „Korrektur nötig“ wählen und die Rückmeldung des Kunden eintragen. Das Projekt geht zurück in die Bearbeitung, der Qualitäts-Haken wird zurückgesetzt. Der nächste Auftrag an Claude enthält das Feedback automatisch, und der Agent setzt jeden Punkt einzeln um.

---

## PDFs in der App

| Dokument | Wo | Inhalt |
|---|---|---|
| **Monatsbericht** | Kundenseite, Bereich Paketverbrauch, „Monatsbericht“ (Monat über die Pfeile wählen) | Kennzahlen, gebuchtes Paket und Umsetzung, Veröffentlichungen mit Links, Projekte, Ausblick. Ohne interne Angaben, zum Weitergeben an den Kunden. |
| **Drehplan** | Projektseite, „Dokumente“ | Datum, Uhrzeit, Ort, Hinweise vor Ort, Ansprechpartner mit Telefon, Shotlist und Equipment zum Abhaken, Hinweise für den Schnitt |
| **Freigabe-Protokoll** | Projektseite, „Dokumente“ | alle Freigaberunden mit Daten und Rückmeldungen, Ergebnis der Endkontrolle, Veröffentlichungen. Als Nachweis der Abnahme. |
| **Briefing** | Startseite, „PDF“ | das Briefing des Tages zum Ausdrucken oder Ablegen |

Die PDFs öffnen sich im Browser und lassen sich dort speichern oder drucken.

## Individuelle PDFs mit Claude

Für alles, was über diese vier hinausgeht, in Claude (Code, Ordner agentur-app) zum Beispiel schreiben:

> Nutze den Agenten „pdf-erstellung“: Erstelle für Kunde 3 ein Angebot über 4 Reels pro Monat ab Januar und lege es im Drive-Ordner des Kunden unter Sonstiges ab.

Der Agent holt Kundendaten aus der App, gestaltet das PDF passend zu den App-Dokumenten und speichert es im Drive-Ordner des Kunden, nie im Repository.

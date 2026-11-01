# Google-Zugang einrichten (Drive, Kalender, Gmail)

Dauer: etwa 10 bis 15 Minuten, einmalig. Du brauchst nur einen Browser und dein Google-Workspace-Konto.

**Warum muss ich das selbst machen?** Die App läuft auf deinem Rechner und meldet sich bei Google mit einem eigenen „Schlüssel“ an. Diesen Schlüssel (Client-ID und Client-Secret) kann nur der Inhaber des Google-Kontos in der Google Cloud Console erzeugen. Er bleibt danach ausschließlich in deiner `.env` auf deinem Rechner.

**Vorteil Google Workspace:** Weil du eine eigene Domain nutzt, richten wir die App als **interne** App ein. Dann gilt:

- keine Prüfung durch Google nötig,
- keine Warnung „Diese App wurde nicht überprüft“,
- die Verbindung läuft **nicht** nach 7 Tagen ab (das passiert nur bei privaten Gmail-Konten im Testmodus),
- nur Konten deiner eigenen Domain können sich anmelden.

> Google benennt Menüpunkte in der Cloud Console gelegentlich um. Wenn ein Begriff nicht genau passt, steht in Klammern der frühere oder englische Name.

---

## Schritt 1: Projekt anlegen

1. Öffne <https://console.cloud.google.com> und melde dich mit deinem Workspace-Konto an (dem Konto, dessen Drive und Kalender die App nutzen soll).
2. Beim ersten Besuch: Land auswählen, Nutzungsbedingungen bestätigen.
3. Oben links neben „Google Cloud“ auf die **Projektauswahl** klicken > **Neues Projekt**.
4. Projektname: `Agentur-Verwaltung`. Organisation: deine Domain (wird automatisch vorgeschlagen). **Erstellen**.
5. Warten, bis die Meldung „Projekt erstellt“ erscheint, und das Projekt oben in der Projektauswahl **auswählen**.

## Schritt 2: Die drei Schnittstellen aktivieren

1. Links im Menü (drei Striche oben links) > **APIs und Dienste** > **Bibliothek**.
2. Nach **Google Drive API** suchen, anklicken, **Aktivieren**.
3. Zurück zur Bibliothek, **Google Calendar API** suchen, **Aktivieren**.
4. Zurück zur Bibliothek, **Gmail API** suchen, **Aktivieren** (wird für das Briefing per E-Mail gebraucht).

## Schritt 3: Anmeldebildschirm einrichten

1. Menü > **APIs und Dienste** > **OAuth-Zustimmungsbildschirm** (heißt inzwischen oft **Google Auth Platform**). Auf **Jetzt starten** (Get started) klicken.
2. **App-Informationen**
   - App-Name: `Agentur-Verwaltung`
   - Nutzersupport-E-Mail: deine Adresse auswählen
   - **Weiter**
3. **Zielgruppe** (Audience): **Intern** auswählen. **Weiter**.
   *Wird „Intern“ nicht angeboten, bist du nicht mit dem Workspace-Konto angemeldet oder das Projekt hängt nicht an deiner Organisation. Dann bitte melden.*
4. **Kontaktdaten**: deine E-Mail-Adresse. **Weiter**.
5. Richtlinie bestätigen, **Weiter**, **Erstellen**.

Bereiche (Scopes) musst du nicht eintragen; die App fragt sie bei der Anmeldung selbst an.

## Schritt 4: Zugangsdaten (Client) erzeugen

1. Im Bereich Google Auth Platform links auf **Clients** klicken (früher: APIs und Dienste > Anmeldedaten > Anmeldedaten erstellen > OAuth-Client-ID).
2. **Client erstellen**.
3. Anwendungstyp: **Webanwendung**.
4. Name: `Agentur-Verwaltung lokal`.
5. Unter **Autorisierte Weiterleitungs-URIs** auf **URI hinzufügen** klicken und exakt eintragen:

   ```
   http://localhost:3000/api/google/callback
   ```

   (ohne Leerzeichen, mit `http`, nicht `https`)

6. **Erstellen**.
7. Es erscheint ein Fenster mit **Client-ID** und **Clientschlüssel** (Client Secret).
   **Wichtig:** Den Clientschlüssel zeigt Google nur in diesem Moment vollständig an. Klicke auf **JSON herunterladen** und bewahre die Datei sicher auf, oder kopiere beide Werte sofort.

## Schritt 5: Zugangsdaten in die App übernehmen

**Empfohlen, ohne Datei-Bearbeitung:**

1. App starten (`npm start`) und links unten **Einstellungen** öffnen.
2. Im Bereich **Google-Verbindung** auf **JSON-Datei auswählen** klicken und die in Schritt 4 heruntergeladene Datei `client_secret_....json` auswählen (meist im Ordner „Downloads“).
3. Die App trägt Client-ID und Clientschlüssel selbst in die `.env` ein und meldet „Zugangsdaten gespeichert“.
4. Auf **Mit Google verbinden** klicken, das Workspace-Konto wählen und den Zugriff erlauben. Danach steht dort „Verbunden mit …“.
5. Die heruntergeladene JSON-Datei danach löschen (die Werte stehen jetzt in der `.env`).

**Alternativ von Hand:** Die Datei `.env` im Ordner `agentur-app` mit einem Texteditor öffnen (sie beginnt mit einem Punkt und ist manchmal ausgeblendet; macOS Finder: `Cmd + Shift + .`), die Zeilen `GOOGLE_CLIENT_ID=` und `GOOGLE_CLIENT_SECRET=` ausfüllen, speichern und die App neu starten.

**Sicherheit:** Client-ID und Clientschlüssel gehören nur in die `.env` auf deinem Rechner. Bitte nicht per E-Mail oder Chat verschicken. Die `.env` wird nie ins Git übertragen.

---

## Falls etwas nicht klappt

| Meldung | Lösung |
|---|---|
| „Fehler 400: redirect_uri_mismatch“ | Die Weiterleitungs-URI aus Schritt 4 stimmt nicht exakt. Prüfen: `http://localhost:3000/api/google/callback`. Wurde in der `.env` ein anderer `PORT` gesetzt, muss die Zahl in der URI dazu passen. |
| „Zugriff blockiert: Die App ist auf Nutzer der Organisation beschränkt“ | Du bist im Browser mit einem anderen Google-Konto angemeldet. Mit dem Workspace-Konto anmelden. |
| „Zugriff blockiert durch Administrator“ | In der Google Admin-Konsole (<https://admin.google.com>) > Sicherheit > Zugriffs- und Datenkontrolle > API-Steuerung > Drittanbieter-App-Zugriff verwalten: die App „Agentur-Verwaltung“ als **Vertrauenswürdig** markieren. |
| „Google Drive API has not been used in project …“ | Schritt 2 für die genannte API wiederholen, dann zwei Minuten warten. |
| Clientschlüssel vergessen | In Clients den Client öffnen > **Secret hinzufügen**, neuen Schlüssel in die `.env` eintragen. |

## Was die App in Google darf

| Bereich | Wozu |
|---|---|
| Google Drive | Kundenordner und Projektordner anlegen, Dateien im Ordner „Fertige Videos“ erkennen. Die App löscht keine Dateien. |
| Google Calendar | Drehtage eintragen, Termine lesen und Änderungen zurück übernehmen. |
| Gmail (nur Senden) | Das tägliche Briefing an dich schicken. Die App kann keine E-Mails lesen. |

Die Verbindung lässt sich jederzeit trennen: in der App unter Einstellungen oder unter <https://myaccount.google.com/permissions>.

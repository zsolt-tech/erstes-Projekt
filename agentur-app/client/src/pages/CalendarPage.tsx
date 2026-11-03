// Kalender: Tag, Woche, Monat und Liste mit Drehtagen, Deadlines, Freigabe-Fristen,
// Veröffentlichungen und Google-Terminen. Einträge der App lassen sich verschieben.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import deLocale from '@fullcalendar/core/locales/de';
import type { DatesSetArg, EventChangeArg, EventClickArg, EventInput } from '@fullcalendar/core';
import { RefreshCw } from 'lucide-react';
import { useCalendarItems, useCalendarSettings, useMoveCalendarItem, useSyncCalendar } from '../api/calendar';
import { useGoogleStatus } from '../api/google';
import { Button, Card, ErrorBox, PageHeader, cx } from '../components/ui';
import { useToast } from '../components/feedback';
import { formatDateTime } from '../lib/format';
import { CALENDAR_KINDS, CALENDAR_KIND_LABELS, type CalendarItem, type CalendarKind } from '../../../shared/schemas';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const local = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function readHidden(): CalendarKind[] {
  try {
    return JSON.parse(localStorage.getItem('calendar-hidden') || '[]');
  } catch {
    return [];
  }
}

function toEvent(item: CalendarItem): EventInput {
  const color = `var(--cal-${item.kind})`;
  return {
    id: item.id,
    title: item.title,
    start: item.start,
    end: item.end ?? undefined,
    allDay: item.all_day,
    backgroundColor: color,
    borderColor: color,
    editable: item.editable,
    durationEditable: item.editable && !item.all_day && (item.kind === 'drehtag'),
    extendedProps: { item },
  };
}

export function CalendarPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [hidden, setHidden] = useState<CalendarKind[]>(readHidden);
  const { data: items = [], error: itemsError } = useCalendarItems(range);
  const { data: google } = useGoogleStatus();
  const { data: settings } = useCalendarSettings(!!google?.connected);
  const sync = useSyncCalendar();
  const move = useMoveCalendarItem();

  const events = useMemo(() => items.filter((i) => !hidden.includes(i.kind)).map(toEvent), [items, hidden]);
  // Sichtbarer Zeitraum der Tages- und Wochenansicht: 6 bis 22 Uhr, erweitert um frühere oder spätere Einträge
  const slots = useMemo(() => {
    let min = 6;
    let max = 22;
    for (const i of items) {
      if (i.all_day) continue;
      const s = new Date(i.start);
      const e = i.end ? new Date(i.end) : s;
      if (!Number.isNaN(s.getTime())) min = Math.min(min, s.getHours());
      if (!Number.isNaN(e.getTime()) && e.toDateString() === s.toDateString()) max = Math.max(max, e.getHours() + (e.getMinutes() ? 1 : 0));
    }
    const hh = (h: number) => `${String(h).padStart(2, '0')}:00:00`;
    return { min: hh(min), max: hh(Math.min(24, max)) };
  }, [items]);
  const counts = useMemo(() => {
    const c: Partial<Record<CalendarKind, number>> = {};
    for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);

  function toggle(kind: CalendarKind) {
    const next = hidden.includes(kind) ? hidden.filter((k) => k !== kind) : [...hidden, kind];
    setHidden(next);
    try {
      localStorage.setItem('calendar-hidden', JSON.stringify(next));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }

  function onDates(arg: DatesSetArg) {
    const next = { start: ymd(arg.start), end: ymd(arg.end) };
    setRange((r) => (r && r.start === next.start && r.end === next.end ? r : next));
  }

  function onClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    const item = arg.event.extendedProps.item as CalendarItem;
    if (item.url) navigate(item.url);
    else if (item.external_url) window.open(item.external_url, '_blank', 'noopener');
  }

  async function onChange(arg: EventChangeArg) {
    const e = arg.event;
    if (!e.start) return arg.revert();
    try {
      await move.mutateAsync({
        id: e.id,
        start: e.allDay ? ymd(e.start) : local(e.start),
        end: e.end ? (e.allDay ? ymd(e.end) : local(e.end)) : null,
        all_day: e.allDay,
      });
      // Wechsel zwischen ganztägig und mit Uhrzeit ausdrücklich melden
      toast.success(
        arg.oldEvent.allDay === e.allDay ? 'Verschoben' : e.allDay ? 'Verschoben, jetzt ganztägig ohne Uhrzeit' : 'Verschoben, jetzt mit Uhrzeit',
      );
    } catch (err) {
      arg.revert();
      toast.error(err);
    }
  }

  const narrow = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <>
      <PageHeader
        title="Kalender"
        subtitle={
          google?.connected ? (
            settings?.last_error ? (
              <span className="text-danger">Abgleich mit Google fehlgeschlagen: {settings.last_error}</span>
            ) : settings?.last_sync_at ? (
              `Mit Google Calendar abgeglichen ${formatDateTime(settings.last_sync_at)}`
            ) : (
              'Abgleich mit Google Calendar läuft alle 5 Minuten'
            )
          ) : (
            <>
              Google ist nicht verbunden.{' '}
              <Link to="/einstellungen" className="text-accent hover:underline">
                Jetzt verbinden
              </Link>
            </>
          )
        }
        actions={
          google?.connected ? (
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={sync.isPending}
              onClick={() =>
                sync.mutateAsync().then(
                  (s) => (s.last_error ? toast.error(s.last_error) : toast.success('Mit Google abgeglichen')),
                  (err) => toast.error(err),
                )
              }
            >
              Jetzt abgleichen
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Einträge ein- und ausblenden">
        {CALENDAR_KINDS.map((kind) => {
          const off = hidden.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggle(kind)}
              aria-pressed={!off}
              className={cx(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] transition-colors',
                off ? 'border-line text-subtle line-through' : 'border-line-strong bg-surface text-fg hover:bg-surface-2',
              )}
            >
              <span className="size-2.5 rounded-full" style={{ background: `var(--cal-${kind})`, opacity: off ? 0.4 : 1 }} />
              {CALENDAR_KIND_LABELS[kind]}
              {counts[kind] ? <span className="text-xs text-muted tabular">{counts[kind]}</span> : null}
            </button>
          );
        })}
      </div>

      <Card>
        {itemsError && <ErrorBox error={itemsError} />}
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={deLocale}
          initialView={narrow ? 'listWeek' : 'timeGridWeek'}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: narrow ? 'listWeek,dayGridMonth' : 'timeGridDay,timeGridWeek,dayGridMonth,listWeek',
          }}
          buttonText={{ today: 'Heute', day: 'Tag', week: 'Woche', month: 'Monat', list: 'Liste' }}
          firstDay={1}
          nowIndicator
          weekNumbers={!narrow}
          weekText="KW"
          slotMinTime={slots.min}
          slotMaxTime={slots.max}
          // Phasenfristen sind ganztägig: nicht in die Stundenleiste ziehen
          eventAllow={(drop, ev) => !(ev?.id.startsWith('phase:') && !drop.allDay)}
          scrollTime="08:00:00"
          allDayText="ganztägig"
          noEventsText="Keine Einträge in diesem Zeitraum"
          height="auto"
          dayMaxEvents={4}
          events={events}
          datesSet={onDates}
          eventClick={onClick}
          eventChange={onChange}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        />
      </Card>
      <p className="mt-3 text-xs text-subtle">
        Drehtage, Deadlines, Aufgaben und Veröffentlichungen lassen sich per Drag-and-Drop verschieben. Freigabe-Fristen ergeben
        sich aus dem Anfragedatum, Google-Termine änderst du in Google Calendar.
      </p>
    </>
  );
}

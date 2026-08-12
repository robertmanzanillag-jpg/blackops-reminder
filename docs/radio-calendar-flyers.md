# Radio flyers from Google Calendar

Google Calendar is the source of truth for Black Room Radio flyers. The `/radio` page syncs Calendar before listing radio events, selects the approved city artwork from the event title, and renders the lineup and date from the event data.

## Event format

Use one of these titles so the correct flyer is selected:

- `BLACK ROOM RADIO MIAMI`
- `BLACK ROOM RADIO BERLIN`
- `BLACK ROOM RADIO BUENOS AIRES`

Put one lineup row per line in the event description:

```text
4pm: ZAMURAI
5pm: DJ NAME
6pm: DJ NAME
7pm: DJ NAME
```

Miami's existing `7pm`, `8pm`, and `9pm` events remain supported. Values such as `TBA`, `OPEN`, `PENDING`, or an empty value leave that row open.

The event start date controls the weekday, ordinal date, and timezone lines. For Berlin and Buenos Aires the flyer also shows the corresponding Miami time. Editing the title, start date/time, or description in Google Calendar changes the next flyer preview and generated asset after synchronization.

## Approved city artwork

- `client/public/radio-flyers/miami.png`
- `client/public/radio-flyers/berlin.png`
- `client/public/radio-flyers/buenos-aires.png`

Do not edit secrets or add a second Google credential flow. This feature reuses the existing Replit Google Calendar connector.

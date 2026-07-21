// Google Calendar Integration - using Replit connector
type GoogleConnectorPurpose = "drive" | "calendar";

let connectionSettings: any;
let connectionSettingsCacheKey: string | null = null;
const BLACK_ROOM_CALENDAR_ENV_VARS = [
  "BLACKROOM_GOOGLE_CALENDAR_ID",
  "GOOGLE_BLACKROOM_CALENDAR_ID",
  "BLACK_ROOM_GOOGLE_CALENDAR_ID",
];
const BLACK_ROOM_CALENDAR_TERMS = ["black room", "blackroom"];
const GOOGLE_CALENDAR_EXTERNAL_ID_SEPARATOR = "::";

async function getGoogleApis() {
  return (await import("googleapis")).google;
}

export function hasReplitGoogleConnectorEnv() {
  return Boolean(
    process.env.REPLIT_CONNECTORS_HOSTNAME &&
    (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL)
  );
}

function findAccessToken(value: any, depth = 0): string | null {
  if (!value || depth > 5) return null;
  if (typeof value !== "object") return null;

  for (const key of ["access_token", "accessToken"]) {
    const token = value[key];
    if (typeof token === "string" && token.trim()) return token;
  }

  for (const child of Object.values(value)) {
    const token = findAccessToken(child, depth + 1);
    if (token) return token;
  }

  return null;
}

function findTokenExpiry(value: any, depth = 0): string | number | null {
  if (!value || depth > 5) return null;
  if (typeof value !== "object") return null;

  for (const key of ["expires_at", "expiresAt", "expiry_date", "expiryDate"]) {
    const expiry = value[key];
    if ((typeof expiry === "string" && expiry.trim()) || typeof expiry === "number") return expiry;
  }

  for (const child of Object.values(value)) {
    const expiry = findTokenExpiry(child, depth + 1);
    if (expiry) return expiry;
  }

  return null;
}

function readConnectorAccessToken(connection: any): string | null {
  return findAccessToken(connection?.settings);
}

function isConnectorTokenFresh(connection: any): boolean {
  const expiresAt = findTokenExpiry(connection?.settings);
  if (!expiresAt) return false;
  const rawExpiryTime = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  const expiryTime = rawExpiryTime > 0 && rawExpiryTime < 10_000_000_000 ? rawExpiryTime * 1000 : rawExpiryTime;
  return Number.isFinite(expiryTime) && expiryTime > Date.now();
}

function isConnectorTokenExplicitlyExpired(connection: any): boolean {
  const expiresAt = findTokenExpiry(connection?.settings);
  if (!expiresAt) return false;
  const rawExpiryTime = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  const expiryTime = rawExpiryTime > 0 && rawExpiryTime < 10_000_000_000 ? rawExpiryTime * 1000 : rawExpiryTime;
  return Number.isFinite(expiryTime) && expiryTime <= Date.now();
}

function getConnectorName(item: any): string {
  return String(item?.name || item?.connector_name || "").toLowerCase();
}

function hasRealCalendarValue(value?: string): value is string {
  return Boolean(value && value.trim() && !/^(replace|your-|todo|changeme|placeholder|example)/i.test(value.trim()));
}

function getConfiguredBlackRoomCalendarId(): string | null {
  for (const name of BLACK_ROOM_CALENDAR_ENV_VARS) {
    const value = process.env[name];
    if (hasRealCalendarValue(value)) return value.trim();
  }
  return null;
}

function normalizeCalendarLookup(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chooseBlackRoomCalendarId(items: any[] = [], fallback: string | null = null): string | null {
  const configured = getConfiguredBlackRoomCalendarId();
  if (configured) return configured;

  const calendars = items.filter((item) => typeof item?.id === "string" && item.id.trim());
  const blackRoomCalendar = calendars.find((item) => {
    const text = normalizeCalendarLookup([
      item.summary,
      item.id,
      item.description,
    ].filter(Boolean).join(" "));
    return BLACK_ROOM_CALENDAR_TERMS.some((term) => text.includes(term));
  });
  if (blackRoomCalendar?.id) return blackRoomCalendar.id;

  return fallback;
}

async function resolveBlackRoomCalendarId(calendar: any, minAccessRole: "reader" | "writer" = "writer"): Promise<string | null> {
  const configured = getConfiguredBlackRoomCalendarId();
  if (configured) return configured;

  const response = await calendar.calendarList.list({ minAccessRole });
  return chooseBlackRoomCalendarId(response.data.items || []);
}

async function requireBlackRoomCalendarId(calendar: any, minAccessRole: "reader" | "writer" = "writer"): Promise<string> {
  const calendarId = await resolveBlackRoomCalendarId(calendar, minAccessRole);
  if (!calendarId) {
    throw new Error("Black Room Google Calendar was not found. Set BLACKROOM_GOOGLE_CALENDAR_ID or make sure the connected calendar name includes Black Room.");
  }
  return calendarId;
}

export function makeGoogleCalendarExternalId(calendarId: string, eventId: string): string {
  return `${calendarId}${GOOGLE_CALENDAR_EXTERNAL_ID_SEPARATOR}${eventId}`;
}

export function parseGoogleCalendarExternalId(value?: string | null): { calendarId?: string; eventId: string } | null {
  if (!value || !String(value).trim()) return null;
  const text = String(value).trim();
  const separatorIndex = text.indexOf(GOOGLE_CALENDAR_EXTERNAL_ID_SEPARATOR);
  if (separatorIndex < 0) return { eventId: text };
  const calendarId = text.slice(0, separatorIndex).trim();
  const eventId = text.slice(separatorIndex + GOOGLE_CALENDAR_EXTERNAL_ID_SEPARATOR.length).trim();
  if (!eventId) return null;
  return calendarId ? { calendarId, eventId } : { eventId };
}

function selectGoogleConnector(items: any[] = [], purpose: GoogleConnectorPurpose = "drive") {
  const connected = items.filter((item) => readConnectorAccessToken(item) && !isConnectorTokenExplicitlyExpired(item));
  const preferredName = purpose === "calendar" ? "google-calendar" : "google-drive";
  const fallbackName = purpose === "calendar" ? "google-drive" : "google-calendar";

  return (
    connected.find((item) => getConnectorName(item).includes(preferredName)) ||
    connected.find((item) => getConnectorName(item).includes(fallbackName)) ||
    connected.find((item) => getConnectorName(item).includes("google")) ||
    connected[0] ||
    null
  );
}

async function getGoogleAccessTokenForPurpose(purpose: GoogleConnectorPurpose) {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  const cacheKey = `${purpose}:${hostname || ""}:${xReplitToken || ""}`;
  if (connectionSettings && connectionSettingsCacheKey === cacheKey && isConnectorTokenFresh(connectionSettings)) {
    const cachedToken = readConnectorAccessToken(connectionSettings);
    if (cachedToken) return cachedToken;
  }

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-drive,google-calendar',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => selectGoogleConnector(data.items || [], purpose));
  connectionSettingsCacheKey = cacheKey;

  const accessToken = readConnectorAccessToken(connectionSettings);

  if (!connectionSettings || !accessToken) {
    throw new Error('Google connector not connected');
  }
  return accessToken;
}

export async function getGoogleAccessToken() {
  return getGoogleAccessTokenForPurpose("drive");
}

export async function getGoogleCalendarAccessToken() {
  return getGoogleAccessTokenForPurpose("calendar");
}

export async function hasConnectedReplitGoogleConnector(): Promise<boolean> {
  if (!hasReplitGoogleConnectorEnv()) return false;
  try {
    await getGoogleAccessToken();
    return true;
  } catch {
    return false;
  }
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
export async function getGoogleCalendarClient() {
  const accessToken = await getGoogleCalendarAccessToken();

  return getGoogleOAuthCalendarClient(accessToken);
}

export async function getGoogleOAuthClient(accessToken: string) {
  const google = await getGoogleApis();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return oauth2Client;
}

async function getGoogleOAuthCalendarClient(accessToken: string) {
  const google = await getGoogleApis();
  const oauth2Client = await getGoogleOAuthClient(accessToken);
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  date: Date;
  endDate?: Date;
  description?: string;
  location?: string;
  isAllDay: boolean;
  source: 'google';
}

function mapEventToCalendarEvent(event: any, calendarId: string): CalendarEvent {
  const isAllDay = !event.start?.dateTime;

  let startDate: Date;
  if (isAllDay && event.start?.date) {
    startDate = new Date(event.start.date + 'T12:00:00');
  } else {
    startDate = new Date(event.start?.dateTime || event.start?.date || new Date());
  }

  let endDate: Date | undefined;
  if (event.end?.dateTime) {
    endDate = new Date(event.end.dateTime);
  } else if (event.end?.date) {
    endDate = new Date(event.end.date + 'T12:00:00');
  }

  let fullDescription = '';
  if (event.location) {
    fullDescription += `📍 ${event.location}\n`;
  }
  if (!isAllDay && event.start?.dateTime) {
    const startTime = startDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    fullDescription += `⏰ ${startTime}${endTime ? ` - ${endTime}` : ''}\n`;
  }
  if (event.description) {
    fullDescription += event.description;
  }

  return {
    id: event.id || '',
    calendarId,
    title: event.summary || 'Sin título',
    date: startDate,
    endDate,
    description: fullDescription.trim() || undefined,
    location: event.location || undefined,
    isAllDay,
    source: 'google' as const,
  };
}

export async function getCalendarEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  try {
    const calendar = await getGoogleCalendarClient();
    const blackRoomCalendarId = await requireBlackRoomCalendarId(calendar, "reader");
    const calendarIds = [blackRoomCalendarId];
    if (process.env.GOOGLE_CALENDAR_INCLUDE_ALL_ACCESSIBLE === "true") {
      const calListResponse = await calendar.calendarList.list({ minAccessRole: 'reader' });
      for (const calId of (calListResponse.data.items || []).map((c: any) => c.id).filter(Boolean) as string[]) {
        if (!calendarIds.includes(calId)) calendarIds.push(calId);
      }
    }

    const seenIds = new Set<string>();
    const allEvents: CalendarEvent[] = [];

    for (const calId of calendarIds) {
      try {
        const response = await calendar.events.list({
          calendarId: calId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 500,
        });

        for (const event of response.data.items || []) {
          if (!event.id) continue;
          const seenKey = `${calId}:${event.id}`;
          if (seenIds.has(seenKey)) continue;
          seenIds.add(seenKey);
          allEvents.push(mapEventToCalendarEvent(event, calId));
        }
      } catch (calErr) {
        // Skip calendars we can't read (permissions, etc.)
        console.warn(`Skipping calendar ${calId}:`, (calErr as any).message);
      }
    }

    return allEvents;
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error);
    throw error;
  }
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  try {
    await getGoogleCalendarAccessToken();
    return true;
  } catch {
    return false;
  }
}

export async function updateCalendarEventDescription(eventId: string, newDescription: string, calendarId?: string): Promise<boolean> {
  try {
    const calendar = await getGoogleCalendarClient();
    const parsedTarget = parseGoogleCalendarExternalId(eventId);
    const targetEventId = parsedTarget?.eventId || eventId;
    const targetCalendarId = calendarId || parsedTarget?.calendarId || await requireBlackRoomCalendarId(calendar, "writer");
    
    // First get the current event
    const currentEvent = await calendar.events.get({
      calendarId: targetCalendarId,
      eventId: targetEventId,
    });
    
    // Update the description
    await calendar.events.patch({
      calendarId: targetCalendarId,
      eventId: targetEventId,
      requestBody: {
        description: newDescription,
      },
    });
    
    return true;
  } catch (error) {
    console.error('Error updating Google Calendar event:', error);
    throw error;
  }
}

export interface UpdateEventParams {
  eventId: string;
  calendarId?: string;
  title?: string;
  date?: string;
  endDate?: string;
  description?: string;
  location?: string;
  isAllDay?: boolean;
}

function getAllDayDateKey(value: string | Date): string {
  if (typeof value === "string") {
    const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateOnlyMatch) return dateOnlyMatch[1];
    return new Date(value).toISOString().split('T')[0];
  }
  return value.toISOString().split('T')[0];
}

function compareDateKeys(a: string, b: string): number {
  return a.localeCompare(b);
}

function addDaysToAllDayDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getAllDayEndDateKey(startDateKey: string, endDate?: Date): string {
  const fallbackEndDateKey = addDaysToAllDayDateKey(startDateKey, 1);
  const endDateKey = endDate ? getAllDayDateKey(endDate) : fallbackEndDateKey;
  return compareDateKeys(endDateKey, startDateKey) > 0 ? endDateKey : fallbackEndDateKey;
}

export function buildGoogleCalendarEventTimeFields(params: {
  date: string;
  endDate?: string;
  isAllDay?: boolean;
}) {
  const endDate = params.endDate
    ? new Date(params.endDate)
    : new Date(new Date(params.date).getTime() + 60 * 60 * 1000);

  if (params.isAllDay) {
    const startDateKey = getAllDayDateKey(params.date);
    return {
      start: { date: startDateKey },
      end: { date: getAllDayEndDateKey(startDateKey, params.endDate ? endDate : undefined) },
    };
  }

  const startDate = new Date(params.date);
  return {
    start: { dateTime: startDate.toISOString(), timeZone: 'America/New_York' },
    end: { dateTime: endDate.toISOString(), timeZone: 'America/New_York' },
  };
}

export async function updateCalendarEvent(params: UpdateEventParams): Promise<boolean> {
  try {
    const calendar = await getGoogleCalendarClient();
    const parsedTarget = parseGoogleCalendarExternalId(params.eventId);
    const targetEventId = parsedTarget?.eventId || params.eventId;
    const targetCalendarId = params.calendarId || parsedTarget?.calendarId || await requireBlackRoomCalendarId(calendar, "writer");
    const requestBody: any = {};

    if (params.title !== undefined) requestBody.summary = params.title;
    if (params.description !== undefined) requestBody.description = params.description;
    if (params.location !== undefined) requestBody.location = params.location;

    if (params.date) {
      Object.assign(requestBody, buildGoogleCalendarEventTimeFields({
        date: params.date,
        endDate: params.endDate,
        isAllDay: params.isAllDay,
      }));
    } else if (params.isAllDay !== undefined) {
      const currentEvent = await calendar.events.get({
        calendarId: targetCalendarId,
        eventId: targetEventId,
      });
      const currentStart = currentEvent.data.start?.dateTime || currentEvent.data.start?.date;
      if (!currentStart) throw new Error("Google Calendar event is missing a start date");
      const currentEnd = currentEvent.data.end?.dateTime || currentEvent.data.end?.date;
      Object.assign(requestBody, buildGoogleCalendarEventTimeFields({
        date: currentStart,
        endDate: currentEnd || undefined,
        isAllDay: params.isAllDay,
      }));
    }

    await calendar.events.patch({
      calendarId: targetCalendarId,
      eventId: targetEventId,
      requestBody,
    });

    return true;
  } catch (error) {
    console.error('Error editing Google Calendar event:', error);
    throw error;
  }
}

export interface CreateEventParams {
  title: string;
  calendarId?: string;
  date: string; // ISO date string for start
  endDate?: string; // ISO date string for end (optional)
  description?: string;
  location?: string;
  isAllDay?: boolean;
}

export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  try {
    const calendar = await getGoogleCalendarClient();
    const targetCalendarId = params.calendarId || await requireBlackRoomCalendarId(calendar, "writer");
    
    let eventBody: any = {
      summary: params.title,
      description: params.description,
      location: params.location,
      ...buildGoogleCalendarEventTimeFields(params),
    };
    
    const response = await calendar.events.insert({
      calendarId: targetCalendarId,
      requestBody: eventBody,
    });
    
    const eventId = response.data.id || '';
    return eventId ? makeGoogleCalendarExternalId(targetCalendarId, eventId) : '';
  } catch (error) {
    console.error('Error creating Google Calendar event:', error);
    throw error;
  }
}

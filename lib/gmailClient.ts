import { google, gmail_v1 } from "googleapis";

export interface FoundMessage {
  messageId: string;
}

function getGmailClient(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

async function listMessagesPage(
  gmail: gmail_v1.Gmail,
  query: string,
  pageToken: string | undefined
): Promise<gmail_v1.Schema$ListMessagesResponse> {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    pageToken,
    maxResults: 100,
  });
  return res.data;
}

/** The Gmail account the access token is actually authenticated as — useful for
 * confirming a search is running against the mailbox the caller expects. */
export async function getAuthenticatedEmail(accessToken: string): Promise<string | undefined> {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data.emailAddress ?? undefined;
}

/**
 * Searches Gmail for messages matching `query`, following pagination until all
 * results are collected. Returns only message IDs — bodies are fetched separately
 * so callers can report progress incrementally.
 */
export async function searchMessages(
  accessToken: string,
  query: string
): Promise<FoundMessage[]> {
  const gmail = getGmailClient(accessToken);
  const messages: FoundMessage[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const page = await listMessagesPage(gmail, query, pageToken);

    for (const m of page.messages ?? []) {
      if (m.id) messages.push({ messageId: m.id });
    }
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);

  return messages;
}

function findHtmlPart(part: gmail_v1.Schema$MessagePart): string | null {
  if (part.mimeType === "text/html" && part.body?.data) {
    return part.body.data;
  }
  for (const child of part.parts ?? []) {
    const found = findHtmlPart(child);
    if (found) return found;
  }
  return null;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | null {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

export interface MessageContent {
  html: string | null;
  /** Outer message's "From" header — used to tell Original vs. Forwarded receipts apart. */
  fromHeader: string | null;
  /** "Subject" header — narrows which receipt parser applies (see parseGrabReceipt). */
  subject: string | null;
  /** When the message reached the mailbox (epoch ms) — for forwarded receipts
   * this is the forward time, always on or after the receipt's own date. */
  receivedAt: number | undefined;
}

/**
 * Fetches a single message's HTML body and its "From"/"Subject" headers. `html` is null
 * if the message has no HTML part (caller should treat this as a skip, not a
 * fatal error). Headers come back on the same `format: "full"` call already
 * needed for the body, so this adds no extra Gmail API round trip.
 */
export async function fetchMessageContent(
  accessToken: string,
  messageId: string
): Promise<MessageContent> {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const receivedAt = res.data.internalDate ? Number(res.data.internalDate) : undefined;
  const payload = res.data.payload;
  if (!payload) return { html: null, fromHeader: null, subject: null, receivedAt };

  const fromHeader = getHeader(payload.headers, "From");
  const subject = getHeader(payload.headers, "Subject");
  const htmlData = findHtmlPart(payload);
  if (!htmlData) return { html: null, fromHeader, subject, receivedAt };

  return { html: decodeBase64Url(htmlData), fromHeader, subject, receivedAt };
}
